#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import figlet from 'figlet';
import boxen from 'boxen';
import dotenv from 'dotenv';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { GeminiAgent } from './src/lib/gemini-agent.js';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
// We'll use dynamic imports to avoid build system issues
// import { SetupManager } from './src/lib/setup-manager.ts';
// import { SessionManager } from './src/lib/session-manager.ts';

// Load environment variables
dotenv.config();

// Capture the actual terminal working directory before anything else happens
// This is needed because the shell script changes to its own directory
const ACTUAL_TERMINAL_CWD =
  process.env.ORIGINAL_TERMINAL_CWD || process.env.PWD || process.cwd();

// Configure markdown rendering for terminal
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    heading: chalk.bold.blue,
    link: chalk.cyan.underline,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.bgBlack.white,
  }),
});

// Enhanced text processing function
function processResponseText(text) {
  // Check if text contains markdown-like content
  const hasMarkdown =
    /^#{1,6}\s|```|\*\*|\*[^*]|\[.*\]\(.*\)|^\s*[\*\-\+]\s/m.test(text);

  if (hasMarkdown) {
    try {
      return marked(text);
    } catch (error) {
      // Fallback to plain text if markdown parsing fails
      return text;
    }
  }

  return text;
}

// Process individual lines during streaming for better formatting
function processStreamingLine(line) {
  // Filter out technical noise first
  let processedLine = line
    // Remove tool IDs and technical messages from agent responses
    .replace(/📨 Received tool results:\s*\n?/g, '')
    .replace(/✅ toolu_[a-zA-Z0-9]+: Success\s*\n?/g, '')
    .replace(/❌ toolu_[a-zA-Z0-9]+: Error\s*\n?/g, '')
    // Remove "Tool execution completed" messages since we show our own
    .replace(/Tool execution completed\. Based on the results.*?\n?/g, '')
    // Remove hidden tool call markers completely
    .replace(/__TOOL_CALLS_HIDDEN__.*?__END_CALLS_HIDDEN__/gs, '');

  // Filter out hidden tool call lines completely
  if (
    /__TOOL_CALLS_HIDDEN__/.test(processedLine) ||
    /__END_CALLS_HIDDEN__/.test(processedLine)
  ) {
    return '';
  }

  // Simple parameter line filtering - only filter obvious parameter lines
  // This is more conservative to avoid hiding legitimate content
  if (/^📋 Parameters:\s*\{/.test(processedLine.trim())) {
    return ''; // Filter out parameter start lines
  }

  // Filter out lines that look like JSON parameter content (conservative approach)
  if (/^\s*["'][a-zA-Z_]+["']:\s*["\{]/.test(processedLine.trim())) {
    return ''; // Filter out obvious JSON parameter lines
  }

  // Filter out closing parameter braces
  if (/^\s*\}\s*$/.test(processedLine.trim())) {
    return ''; // Filter out standalone closing braces
  }

  // If line was filtered out completely, return empty
  if (!processedLine.trim()) {
    return '';
  }

  // Apply simple formatting instead of full markdown processing to avoid breaking numbered lists
  // Only process headers with markdown, handle other formatting manually
  if (/^#{1,6}\s/.test(processedLine)) {
    try {
      processedLine = marked(processedLine);
    } catch (error) {
      // Fallback to manual header formatting
      processedLine = processedLine.replace(
        /^(#{1,6})\s+(.+)$/g,
        (match, hashes, text) => {
          const level = hashes.length;
          if (level === 1) return `${chalk.bold.blue(text)}\n`;
          if (level === 2) return `${chalk.bold.cyan(text)}\n`;
          if (level === 3) return `${chalk.bold.yellow(text)}\n`;
          return `${chalk.bold(text)}\n`;
        }
      );
    }
  } else {
    // Manual formatting for other elements to preserve list numbering
    processedLine = processedLine
      // Bold text
      .replace(/\*\*(.*?)\*\*/g, chalk.bold('$1'))
      .replace(/__(.*?)__/g, chalk.bold('$1'))
      // Italic text
      .replace(/\*(.*?)\*/g, chalk.italic('$1'))
      .replace(/_(.*?)_/g, chalk.italic('$1'))
      // Inline code
      .replace(/`(.*?)`/g, chalk.bgBlack.white(' $1 '))
      // Links (basic formatting)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        `${chalk.cyan.underline('$1')}${chalk.dim(' ($2)')}`
      );
  }

  // Apply enhanced formatting for tool execution messages
  processedLine = processedLine
    .replace(
      /🔧 Requesting tool execution:/g,
      chalk.blue('🔧 Requesting tool execution:')
    )
    .replace(/✅ Tool completed/g, chalk.green('✅ Tool completed'))
    // Format diff and git messages
    .replace(
      /💡 \*\*Large diff detected!\*\*/g,
      chalk.yellow('💡 **Large diff detected!**')
    )
    .replace(
      /📊 \*\*Diff Statistics:\*\*/g,
      chalk.cyan('📊 **Diff Statistics:**')
    )
    .replace(/🎨 \*\*Git Diff\*\*/g, chalk.magenta('🎨 **Git Diff**'))
    .replace(/📄 \*\*Git Diff\*\*/g, chalk.blue('📄 **Git Diff**'));

  return processedLine;
}

// Initialize local Gemini agent (will be initialized in action handler)
let geminiAgent;

// Session management
let sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Available slash commands
const slashCommands = [
  { name: '/help', description: 'Show available commands' },
  { name: '/clear', description: 'Clear screen and show header' },
  { name: '/session', description: 'Start a new session' },
  { name: '/continue', description: 'Continue from last session' },
  { name: '/context', description: 'Show current work context' },
  { name: '/goal', description: 'Set or update current goal' },
  { name: '/diff', description: 'Show git diff with beautiful formatting' },
  {
    name: '/diff-save',
    description: 'Save full diff to file for large changes',
  },
  { name: '/undo', description: 'Undo recent changes made by the agent' },
  { name: '/changes', description: 'Show recent changes made by the agent' },
  { name: '/quit', description: 'Exit the CLI' },
];

// Smart input handler with command hints
async function getInput(setupManager) {
  // Get suggested commands from project config
  const suggestedCommands = setupManager
    ? await setupManager.getSuggestedCommands()
    : [];

  // Show available slash commands hint
  const commandHint = chalk.dim(
    '\n💡 Type "/" for commands: /help /clear /session /context /diff /diff-save /quit\n'
  );

  const { message } = await inquirer.prompt([
    {
      type: 'input',
      name: 'message',
      message: chalk.blue('You:'),
      prefix: '💬',
      transformer: (input) => {
        // Show available commands only when user types just "/"
        if (input === '/') {
          return (
            chalk.cyan('/') +
            chalk.dim(
              ' (type command name: help, clear, session, context, diff, diff-save, quit)'
            )
          );
        }
        return input;
      },
      // Add autocomplete suggestions
      suggest: async (input) => {
        const suggestions = [];

        // Add slash commands
        if (input.startsWith('/')) {
          const slashSuggestions = slashCommands
            .filter((cmd) => cmd.name.startsWith(input))
            .map((cmd) => ({ name: cmd.name, value: cmd.name }));
          suggestions.push(...slashSuggestions);
        }

        // Add project commands
        if (suggestedCommands.length > 0 && !input.startsWith('/')) {
          const projectSuggestions = suggestedCommands
            .filter((cmd) => cmd.includes(input))
            .map((cmd) => ({ name: cmd, value: cmd }));
          suggestions.push(...projectSuggestions);
        }

        return suggestions;
      },
    },
  ]);

  // Now safe to track command history in global config directory
  if (setupManager && message && !message.startsWith('/')) {
    await setupManager.addRecentCommand(message);
  }

  return message;
}

// Display beautiful header
function showHeader() {
  console.clear();
  console.log(
    chalk.cyan(
      figlet.textSync('Local Mind', {
        font: 'Small',
        horizontalLayout: 'fitted',
      })
    )
  );
  console.log(chalk.dim('  Powered by Gemini 2.5 Flash-Lite\n'));
}

// Send message to agent with beautiful streaming and tool call handling
async function sendMessage(
  message,
  showSpinner = true,
  sessionManager = null,
  progressManager = null
) {
  let spinner;

  if (showSpinner) {
    if (progressManager) {
      progressManager.start({
        type: 'spinner',
        message: chalk.blue('🤖 Agent is thinking...')
      });
    } else {
      spinner = ora({
        text: chalk.blue('🤖 Agent is thinking...'),
        spinner: 'dots',
      }).start();
    }
  }

  try {
    const history = sessionManager ? (await sessionManager.getCurrentSession())?.contextMessages || [] : [];
    const messages = history.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    if (message) {
      messages.push({ role: 'user', content: message });
    }

    const { textStream, fullStream } = await geminiAgent.chat(messages);

    if (progressManager) {
      progressManager.stop();
    } else if (spinner) {
      spinner.stop();
    }

    console.log(chalk.green('\n🤖 Agent:'));
    console.log(chalk.dim('─'.repeat(60)));

    let fullResponse = '';
    
    // Process the stream
    for await (const part of fullStream) {
      if (part.type === 'text-delta') {
        const text = part.textDelta;
        fullResponse += text;
        const processed = processStreamingLine(text);
        if (processed) {
          process.stdout.write(processed);
        }
      } else if (part.type === 'tool-call') {
        console.log(chalk.blue(`\n🔧 Executing tool: ${part.toolName}...`));
      } else if (part.type === 'tool-result') {
        if (part.result) {
          console.log(chalk.green(`✅ Tool completed`));
        }
      }
    }

    console.log('\n' + chalk.dim('─'.repeat(60)));

    if (sessionManager && fullResponse) {
      await sessionManager.addMessage('assistant', fullResponse);
    }
  } catch (error) {
    if (progressManager) {
      progressManager.fail(chalk.red('Failed to communicate with agent'));
    } else if (spinner) {
      spinner.fail(chalk.red('Failed to communicate with agent'));
    }

    console.error(chalk.red(`❌ Error: ${error.message}`));
  }
}

// Interactive mode
async function interactiveMode() {
  showHeader();

  // Initialize setup manager for first-time experience
  // Use dynamic imports to avoid build system issues
  let setupManager = null;
  let sessionManager = null;
  let progressManager = null;
  let undoManager = null;
  
  try {
    const { SetupManager } = await import('./src/lib/setup-manager.ts');
    const { SessionManager } = await import('./src/lib/session-manager.ts');
    const { progressManager: pm } = await import('./src/lib/progress-manager.ts');
    const { UndoManager } = await import('./src/lib/undo-manager.ts');
    
    progressManager = pm;
    
    // Show progress for initialization
    progressManager.createSteps([
      'Initializing setup manager',
      'Loading project configuration',
      'Setting up session manager'
    ]);
    
    setupManager = new SetupManager(ACTUAL_TERMINAL_CWD);
    progressManager.nextStep();
    
    await setupManager.initialize();
    progressManager.nextStep();
    
    sessionManager = new SessionManager(ACTUAL_TERMINAL_CWD);
    await sessionManager.initialize();
    progressManager.nextStep();
    
    // Initialize undo manager with session ID
    undoManager = new UndoManager(sessionId);
    await undoManager.initialize();
  } catch (error) {
    if (progressManager) progressManager.stop();
    console.warn(chalk.yellow('⚠️  Enhanced features unavailable:', error.message));
    // Continue without enhanced features
  }

  console.log(
    boxen(
      `${chalk.green('🚀 Interactive Mode')}\n\n` +
        `${chalk.cyan('Commands:')}\n` +
        `  ${chalk.white('/help')}     - Show this help\n` +
        `  ${chalk.white('/clear')}    - Clear screen\n` +
        `  ${chalk.white('/session')}  - New session\n` +
        `  ${chalk.white('/context')}   - Show work context\n` +
        `  ${chalk.white('/diff')}     - Show git diff\n` +
        `  ${chalk.white('/diff-save')} - Save full diff to file\n` +
        `  ${chalk.white('/undo')}     - Undo recent changes\n` +
        `  ${chalk.white('/changes')}  - Show recent changes\n` +
        `  ${chalk.white('/quit')}     - Exit\n\n` +
        `${chalk.yellow('💡 Tip:')} Just type your coding questions naturally!`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );

  // Welcome message
  // await sendMessage("Hello! I'm your coding agent. What would you like to work on today?");

  while (true) {
    console.log(); // Empty line for spacing

    const message = await getInput(setupManager);

    if (!message.trim()) continue;

    // Handle special commands and suggestions
    const trimmedMessage = message.toLowerCase().trim();

    // Show available commands when user types just "/"
    if (trimmedMessage === '/') {
      console.log(chalk.yellow('💡 Available commands:'));
      for (const command of slashCommands) {
        console.log(
          `  ${chalk.cyan(command.name)} - ${chalk.dim(command.description)}`
        );
      }
      continue;
    }

    switch (trimmedMessage) {
      case '/help':
        console.log(
          boxen(
            // biome-ignore lint/style/useTemplate: <explanation>
            `${chalk.green('Available Commands:')}\n\n` +
              `${chalk.white('/help')}     - Show this help\n` +
              `${chalk.white('/clear')}    - Clear screen and show header\n` +
              `${chalk.white('/session')}  - Start a new session\n` +
              `${chalk.white('/continue')} - Continue from last session\n` +
              `${chalk.white('/context')}   - Show current work context and goals\n` +
              `${chalk.white('/goal')}     - Set or update current goal\n` +
              `${chalk.white('/diff')}     - Show git diff with beautiful formatting\n` +
              `${chalk.white('/diff-save')} - Save full diff to file for large changes\n` +
              `${chalk.white('/undo')}     - Undo recent changes made by the agent\n` +
              `${chalk.white('/changes')}  - Show recent changes made by the agent\n` +
              `${chalk.white('/quit')}     - Exit the CLI\n\n` +
              `${chalk.cyan('Examples:')}\n` +
              `• "What does package.json contain?"\n` +
              `• "Create a FastAPI server with authentication"\n` +
              `• "Fix the bug in src/main.py"\n` +
              `• "Run the tests and show me the results"`,
            { padding: 1, borderStyle: 'round', borderColor: 'green' }
          )
        );
        continue;

      case '/clear':
        showHeader();
        continue;

      case '/session':
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (sessionManager) {
          await sessionManager.startNewSession();
        }
        console.log(chalk.green('✨ New session started!'));
        continue;

      case '/continue':
        if (sessionManager) {
          const continueMsg = await sessionManager.continueLastSession();
          console.log(processResponseText(continueMsg));
        } else {
          console.log(chalk.yellow('Session features not available'));
        }
        continue;

      case '/context':
        if (sessionManager) {
          const summary = await sessionManager.getSummary();
          console.log(processResponseText(summary));
        } else {
          console.log(chalk.yellow('Session features not available'));
        }
        continue;

      case '/goal':
        const { goal } = await inquirer.prompt([
          {
            type: 'input',
            name: 'goal',
            message: chalk.blue('What are you working on?'),
            prefix: '🎯',
          },
        ]);
        if (goal && goal.trim()) {
          if (sessionManager) {
            await sessionManager.updateGoal(goal.trim());
          }
          console.log(chalk.green(`✅ Goal set: ${goal.trim()}`));
        }
        continue;

      case '/diff':
        await sendMessage(
          'Show me the git diff of all changed files with beautiful formatting.',
          true,
          sessionManager,
          progressManager
        );
        continue;

      case '/diff-save': {
        const filename = `changes_${new Date().toISOString().slice(0, 10)}_${Date.now()}.patch`;
        await sendMessage(
          `Save the full git diff to file: ${filename}`,
          true
        );
        continue;
      }
      
      case '/undo':
        if (undoManager) {
          await undoManager.interactiveUndo();
        } else {
          console.log(chalk.yellow('Undo feature not available'));
        }
        continue;
        
      case '/changes':
        if (undoManager) {
          await undoManager.showRecentChanges();
        } else {
          console.log(chalk.yellow('Change tracking not available'));
        }
        continue;

      case '/quit':
      case '/exit':
        console.log(chalk.yellow('👋 Goodbye! Happy coding!'));
        process.exit(0);
    }

    // Now safe to track sessions in global config directory
    if (sessionManager) {
      await sessionManager.addMessage('user', message);
    }

    await sendMessage(message, true, sessionManager, progressManager);
  }
}

// Project detection
async function detectProject() {
  const projectFiles = [
    'package.json',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
    '.git',
  ];
  const detectedFiles = [];

  // Use the actual terminal directory for file access
  const { access: accessFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  for (const file of projectFiles) {
    try {
      await accessFile(join(ACTUAL_TERMINAL_CWD, file));
      detectedFiles.push(file);
    } catch {
      // File doesn't exist, ignore
    }
  }

  if (detectedFiles.length > 0) {
    console.log(chalk.green('🔍 Project detected:'));
    for (const file of detectedFiles) {
      const icon = file === '.git' ? '📁' : '📄';
      console.log(`  ${icon} ${file}`);
    }
    console.log();
  }
}

// Setup CLI commands
const program = new Command();

program
  .name('coder')
  .description('AI-powered coding assistant')
  .version('1.0.0');

program
  .argument('[message...]', 'Direct message to the coding agent')
  .option('-i, --interactive', 'Start interactive mode')
  .option('-p, --project <path>', 'Set project directory')
  .option('--session <id>', 'Use specific session ID')
  .action(async (messageArray, options) => {
    // Set custom session if provided
    if (options.session) {
      sessionId = options.session;
    }

    // Change directory if project path specified
    if (options.project) {
      try {
        process.chdir(options.project);
        console.log(chalk.blue(`📁 Working in: ${process.cwd()}`));
      } catch (error) {
        console.error(
          chalk.red(`❌ Cannot access directory: ${options.project}`)
        );
        process.exit(1);
      }
    }

    await detectProject();

    // Initialize Gemini agent with the determined working directory
    geminiAgent = new GeminiAgent(process.cwd());

    if (options.interactive || messageArray.length === 0) {
      await interactiveMode();
    } else {
      showHeader();
      const message = messageArray.join(' ');
      console.log(chalk.blue(`💬 You: ${message}\n`));
      await sendMessage(message, true);
      console.log(); // Final newline
    }
  });

// Handle errors gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Goodbye! Happy coding!'));
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Unexpected error:'), error.message);
  process.exit(1);
});

program.parse();
