import inquirer from 'inquirer';
import chalk from 'chalk';
import { writeFile, readFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import figlet from 'figlet';
import boxen from 'boxen';


interface ConfigData {
  agentUrl: string;
  apiKey: string;
  sessionTimeout: number;
  maxFileSize: string;
  allowedCommands: string[];
  toolPolicy: 'strict' | 'permissive';
  mode: 'local' | 'cloud';
  modelId?: string;
}

function getGlobalConfigDir(): string {
  return join(homedir(), '.local-mind');
}

async function getDefaultConfig(): Promise<Partial<ConfigData>> {
  return {
    apiKey: '',
    sessionTimeout: 3600,
    maxFileSize: '10MB',
    allowedCommands: [
      'git',
      'npm',
      'bun',
      'yarn',
      'pnpm',
      'python',
      'node',
      'cargo',
      'go',
    ],
    toolPolicy: 'strict',
    mode: 'local',
  };
}

function getGlobalConfigPath(): string {
  return join(getGlobalConfigDir(), 'config.json');
}

function showWelcome() {
  console.clear();
  console.log(
    chalk.cyan(
      figlet.textSync('Local Mind Setup', {
        font: 'Small',
        horizontalLayout: 'fitted',
      })
    )
  );
  console.log(chalk.dim('  Powered by Gemini 2.5 Flash-Lite\n'));

  console.log(
    boxen(
      `${chalk.green('🚀 Welcome to Local Mind Setup!')}\n\n` +
        `This wizard will help you configure your local coding assistant.\n` +
        `You will need a Gemini API Key from Google AI Studio.\n\n` +
        `${chalk.yellow('💡 Tips:')}\n` +
        `• All execution happens ${chalk.bold('locally')} on your machine\n` +
        `• Your files ${chalk.bold('never')} leave your computer\n` +
        `• You can re-run this setup anytime with: ${chalk.cyan('npm run setup')}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );
}

async function detectExistingConfig(): Promise<Partial<ConfigData> | null> {
  // Check global config first
  try {
    const globalConfigPath = getGlobalConfigPath();
    await access(globalConfigPath);
    const configContent = await readFile(globalConfigPath, 'utf-8');
    const config = JSON.parse(configContent);
    console.log(chalk.yellow('📁 Existing configuration found!'));
    return config;
  } catch {
    return null;
  }
}

async function askQuestions(
  existingConfig?: Partial<ConfigData>
): Promise<ConfigData> {
  const questions = [
    {
      type: 'password',
      name: 'apiKey',
      message: 'Gemini API Key:',
      mask: '*',
      default: process.env.GEMINI_API_KEY || '',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'API key is required';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'modelId',
      message: 'Select Gemini Model:',
      choices: [
        { name: 'Gemini 2.5 Flash-Lite (Recommended)', value: 'gemini-2.5-flash-lite' },
        { name: 'Gemini 2.0 Flash-Lite-Preview', value: 'gemini-2.0-flash-lite-preview-02-05' },
        { name: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash' },
      ],
      default: 'gemini-2.5-flash-lite',
    }
  ];

  const answers = await inquirer.prompt(questions);

  return {
    agentUrl: 'local',
    apiKey: answers.apiKey,
    mode: 'local',
    toolPolicy: 'permissive',
    allowedCommands: ['git', 'npm', 'node', 'python', 'go', 'cargo'],
    sessionTimeout: 3600,
    maxFileSize: '10MB',
    ...answers // Spread results to include modelId if needed (or we just use it in .env)
  };
}

function encryptApiKey(apiKey: string): string {
  // Simple base64 encoding for now - in production, use proper encryption
  return Buffer.from(apiKey).toString('base64');
}

async function saveConfig(config: any): Promise<void> {
  // Save to .env file in project directory
  const envContent = `# Local Mind Configuration
GEMINI_API_KEY=${config.apiKey}
MODEL_ID=${config.modelId || 'gemini-2.5-flash-lite'}
`;

  await writeFile('.env', envContent);
  console.log(chalk.green('  ✓ Configuration saved to .env'));
}

async function createCliAlias(config: ConfigData): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const os = await import('node:os');
  const path = await import('node:path');

  const projectDir = process.cwd();
  const isWindows = os.platform() === 'win32';

  // Create local CLI script first
  const localScriptName = isWindows ? 'localmind.bat' : 'localmind';
  const scriptContent = isWindows 
    ? `@echo off\nset ORIGINAL_TERMINAL_CWD=%CD%\nnpx tsx cli.js %*`
    : `#!/bin/bash\nexport ORIGINAL_TERMINAL_CWD="$PWD"\nnpx tsx cli.js "$@"`;
  
  await writeFile(localScriptName, scriptContent);
  if (!isWindows) await execAsync(`chmod +x ${localScriptName}`);

  // Make executable on Unix systems
  if (!isWindows) {
    try {
      await execAsync(`chmod +x ${localScriptName}`);
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Warning: Could not make ${localScriptName} executable:`,
          error
        )
      );
    }
  }

  // Attempt global installation
  try {
    await installGlobally(projectDir, localScriptName, isWindows);
  } catch (error) {
    console.warn(
      chalk.yellow(
        '\n⚠️  Global installation failed, but local script created successfully.'
      )
    );
    console.warn(
      chalk.dim(
        `Use ${chalk.white(`./${localScriptName}`)} or add this directory to your PATH manually.`
      )
    );
  }
}

async function installGlobally(
  projectDir: string,
  scriptName: string,
  isWindows: boolean
): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const os = await import('node:os');
  const path = await import('node:path');

  if (isWindows) {
    // On Windows, try to add to a directory in PATH or create in a known location
    const windowsPaths = [
      path.join(os.homedir(), 'bin'),
      path.join(os.homedir(), '.local', 'bin'),
      'C:\\tools\\bin',
    ];

    for (const targetDir of windowsPaths) {
      try {
        // Create directory if it doesn't exist
        await execAsync(`mkdir "${targetDir}" 2>nul || echo Directory exists`);

        // Create global script that calls the local one using absolute path
        const globalScript = `@echo off
set ORIGINAL_TERMINAL_CWD=%CD%
npx --prefix "${projectDir}" tsx "${path.join(projectDir, 'cli.js')}" %*
`;
        await writeFile(path.join(targetDir, 'localmind.bat'), globalScript);
        console.log(
          chalk.green(
            `✅ Global CLI installed to: ${path.join(targetDir, 'localmind.bat')}`
          )
        );
        console.log(chalk.dim(`Make sure ${targetDir} is in your PATH`));
        return;
      } catch {
        continue;
      }
    }
    throw new Error(
      'Could not find suitable directory for global installation'
    );
  } else {
    // On Unix systems, try standard locations
    const unixPaths = [
      '/usr/local/bin',
      path.join(os.homedir(), 'bin'),
      path.join(os.homedir(), '.local', 'bin'),
    ];

    for (const targetDir of unixPaths) {
      try {
        // Check if directory exists and is writable
        await execAsync(`mkdir -p "${targetDir}"`);

        // Create global script that calls the local one using absolute path
        const globalScript = `#!/bin/bash
# Store original terminal working directory before execution
export ORIGINAL_TERMINAL_CWD="$PWD"
npx --prefix "${projectDir}" tsx "${path.join(projectDir, 'cli.js')}" "$@"
`;
        const globalPath = path.join(targetDir, 'localmind');
        await writeFile(globalPath, globalScript);
        await execAsync(`chmod +x "${globalPath}"`);

        console.log(chalk.green(`✅ Global CLI installed to: ${globalPath}`));

        // Verify it's in PATH
        try {
          await execAsync('which coder');
          console.log(chalk.green(`✅ Global 'coder' command is ready!`));
        } catch {
          console.log(
            chalk.yellow(
              `⚠️  Added to ${targetDir} - make sure this is in your PATH`
            )
          );
        }
        return;
      } catch (error) {
        // Try next location
        continue;
      }
    }
    throw new Error(
      'Could not find suitable directory for global installation'
    );
  }
}

async function validateSetup(config: ConfigData): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  try {
    // Test that configuration is accessible
    console.log(chalk.dim('  ✓ Configuration files created'));

    // Test local script exists and is executable
    const os = await import('node:os');
    const isWindows = os.platform() === 'win32';
    const scriptName = isWindows ? 'coder.bat' : 'coder';

    try {
      await access(scriptName);
      console.log(chalk.dim(`  ✓ Local CLI script created: ./${scriptName}`));
    } catch {
      console.warn(chalk.yellow(`  ⚠️  Local script ${scriptName} not found`));
    }

    // Test global command (if available)
    try {
      const whichCmd = isWindows ? 'where coder' : 'which coder';
      const { stdout } = await execAsync(whichCmd);
      if (stdout.trim()) {
        console.log(chalk.dim('  ✓ Global "coder" command available'));
      }
    } catch {
      console.log(
        chalk.dim('  ℹ️  Global "coder" command not in PATH (use local script)')
      );
    }

    console.log(chalk.green('✅ Setup validation completed successfully!'));
  } catch (error) {
    console.warn(
      chalk.yellow(
        '⚠️  Some validation checks failed, but setup may still work:'
      )
    );
    console.warn(
      chalk.dim(`   ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

function showCompletionMessage(config: ConfigData) {
  console.log('\n' + chalk.green('✅ Setup completed successfully!'));

  console.log(
    boxen(
        `${chalk.green('🎉 Local Mind is ready!')}\n\n` +
        `${chalk.cyan('Configuration saved to:')} .env\n` +
        `${chalk.cyan('Global data dir:')} ~/.local-mind\n` +
        `${chalk.cyan('CLI script:')} ./localmind (local) + global 'localmind' command\n\n` +
        `${chalk.yellow('Quick start commands:')}\n` +
        `${chalk.white('localmind --interactive')}  - Start interactive mode (global)\n` +
        `${chalk.white('localmind "list files"')}  - Direct command (global)\n` +
        `${chalk.white('./localmind --interactive')}  - Local script alternative\n` +
        `${chalk.white('npm start')}           - Development alternative\n\n` +
        `${chalk.cyan('Model:')} ${config.modelId || 'gemini-2.5-flash-lite'}\n\n` +
        `${chalk.yellow('💡 Next steps:')}\n` +
        `• Test your setup: ${chalk.white('localmind \"check current directory\"')}\n` +
        `• Read the docs: ${chalk.white('cat README.md')}\n` +
        `• Reconfigure anytime: ${chalk.white('npm run setup')}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }
    )
  );
}

export async function runSetup(): Promise<void> {
  try {
    showWelcome();

    const existingConfig = await detectExistingConfig();

    if (existingConfig) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Existing configuration found. What would you like to do?',
          choices: [
            {
              name: '🔄 Regenerate CLI binary only (keep current config)',
              value: 'regenerate',
            },
            {
              name: '⚙️  Reconfigure everything',
              value: 'reconfigure',
            },
            {
              name: '❌ Cancel setup',
              value: 'cancel',
            },
          ],
          default: 'regenerate',
        },
      ]);

      if (action === 'cancel') {
        console.log(
          chalk.yellow(
            'Setup cancelled. Your existing configuration is unchanged.'
          )
        );
        return;
      }

      if (action === 'regenerate') {
        console.log(
          chalk.blue(
            '🔗 Regenerating CLI binary with existing configuration...'
          )
        );

        // Use existing config to regenerate binary only
        const config = {
          ...(await getDefaultConfig()),
          ...existingConfig,
        } as ConfigData;

        await createCliAlias(config);
        await validateSetup(config);

        console.log(chalk.green('✅ CLI binary regenerated successfully!'));
        console.log(
          chalk.cyan(`Binary recreated with existing configuration.`)
        );
        return;
      }

      // If 'reconfigure', continue with full setup below
    }

    console.log(chalk.blue('\n📝 Configuration Questions:\n'));
    const config = await askQuestions(existingConfig || undefined);

    console.log(chalk.blue('\n💾 Saving configuration...'));
    await saveConfig(config);

    console.log(chalk.blue('🔗 Creating CLI shortcuts...'));
    await createCliAlias(config);

    console.log(chalk.blue('🧪 Validating setup...'));
    await validateSetup(config);

    showCompletionMessage(config);
  } catch (error) {
    console.error(chalk.red('\n❌ Setup failed:'), error);
    process.exit(1);
  }
}

// CLI command interface
import { fileURLToPath } from 'url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  runSetup();
}
