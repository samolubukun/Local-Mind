import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { ToolProxy } from '../../cli/tool-proxy.js';
import chalk from 'chalk';

export class GeminiAgent {
  private model: LanguageModel;
  private toolProxy: ToolProxy;
  private systemPrompt: string;

  constructor(workingDirectory?: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }

    // Initialize Gemini model
    const google = createGoogleGenerativeAI({ apiKey });
    this.model = google(process.env.MODEL_ID || 'gemini-2.5-flash-lite') as any;

    this.toolProxy = new ToolProxy(
      {
        info: (msg: string) => console.log(chalk.dim(`[TOOL] ${msg}`)),
        error: (msg: string) => console.error(chalk.red(`[TOOL ERROR] ${msg}`)),
        warn: (msg: string) => console.warn(chalk.yellow(`[TOOL WARN] ${msg}`)),
      },
      workingDirectory
    );

    this.systemPrompt = `You are a local AI coding assistant powered by Gemini 2.5 Flash-Lite. You execute tools on the user's local machine.

## CORE PRINCIPLES
1. **BE EFFICIENT**: Only use tools when absolutely necessary.
2. **BE COMPLETE**: You're an agent. Finish the ENTIRE task.
3. **BE CONCISE**: Action-oriented responses only.
4. **BE PROACTIVE**: Don't ask permission. Just do it.

## TECHNICAL GUIDELINES
- Use relative paths from current working directory.
- Always check file contents before modifying them.
- Use git_diff for repository changes.
- Use run_command for shell operations.

Remember: Complete the task. Use tools wisely. Be brief.`;
  }

  getTools() {
    return {
      read_file: tool({
        description: 'Read the contents of a file',
        inputSchema: z.object({
          path: z.string().describe('The file path to read'),
        }),
        execute: async ({ path }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'read_file',
            parameters: { path },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      write_file: tool({
        description: 'Write content to a file',
        inputSchema: z.object({
          path: z.string().describe('The file path to write to'),
          content: z.string().describe('The content to write'),
        }),
        execute: async ({ path, content }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'write_file',
            parameters: { path, content },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      list_directory: tool({
        description: 'List contents of a directory',
        inputSchema: z.object({
          path: z.string().describe('The directory path to list'),
        }),
        execute: async ({ path }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'list_directory',
            parameters: { path },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      create_directory: tool({
        description: 'Create a new directory',
        inputSchema: z.object({
          path: z.string().describe('The directory path to create'),
        }),
        execute: async ({ path }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'create_directory',
            parameters: { path },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      move_file: tool({
        description: 'Move or rename a file',
        inputSchema: z.object({
          source: z.string().describe('Source path'),
          destination: z.string().describe('Destination path'),
        }),
        execute: async ({ source, destination }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'move_file',
            parameters: { source, destination },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      delete_file: tool({
        description: 'Delete a file',
        inputSchema: z.object({
          path: z.string().describe('File path to delete'),
        }),
        execute: async ({ path }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'delete_file',
            parameters: { path },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      run_command: tool({
        description: 'Run a shell command',
        inputSchema: z.object({
          command: z.string().describe('The command to execute'),
          workingDir: z.string().optional().describe('The working directory'),
        }),
        execute: async ({ command, workingDir }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'run_command',
            parameters: { command, workingDir },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      grep_search: tool({
        description: 'Search for a pattern in files',
        inputSchema: z.object({
          pattern: z.string().describe('The pattern to search for'),
          path: z.string().optional().describe('The path to search in'),
          filePattern: z.string().optional().describe('File pattern (e.g. *.ts)'),
          caseSensitive: z.boolean().optional().describe('Case sensitive search'),
        }),
        execute: async (params) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'grep_search',
            parameters: params,
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      find_files: tool({
        description: 'Find files by pattern',
        inputSchema: z.object({
          pattern: z.string().describe('File pattern to find'),
          path: z.string().optional().describe('Starting directory'),
          type: z.enum(['file', 'directory', 'both']).optional().describe('Type to search for'),
        }),
        execute: async (params) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'find_files',
            parameters: params,
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      execute_code: tool({
        description: 'Execute code in a sandbox (requires RIZA_API_KEY)',
        inputSchema: z.object({
          language: z.enum(['python', 'javascript', 'typescript']).describe('Programming language'),
          code: z.string().describe('The code to execute'),
          input: z.string().optional().describe('Optional input'),
        }),
        execute: async (params) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'execute_code',
            parameters: params,
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      diff_files: tool({
        description: 'Compare two files',
        inputSchema: z.object({
          file1: z.string().describe('First file path'),
          file2: z.string().describe('Second file path'),
        }),
        execute: async ({ file1, file2 }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'diff_files',
            parameters: { file1, file2 },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      git_diff: tool({
        description: 'Show git diff',
        inputSchema: z.object({
          staged: z.boolean().optional().describe('Show staged changes'),
          files: z.array(z.string()).optional().describe('Specific files to diff'),
        }),
        execute: async (params) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'git_diff',
            parameters: params,
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      set_work_context: tool({
        description: 'Set the current work goal and status',
        inputSchema: z.object({
          goal: z.string().describe('The main goal'),
          description: z.string().optional().describe('Goal description'),
          status: z.enum(['starting', 'in-progress', 'testing', 'complete']).optional().describe('Current status'),
        }),
        execute: async (params) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'set_work_context',
            parameters: params,
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      get_work_context: tool({
        description: 'Get the current work context',
        inputSchema: z.object({
          includeHistory: z.boolean().optional().describe('Include history'),
        }),
        execute: async ({ includeHistory }) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'get_work_context',
            parameters: { includeHistory },
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
      project_context: tool({
        description: 'Analyze project structure and configuration',
        inputSchema: z.object({
          action: z.enum(['analyze', 'get-commands', 'get-config', 'update-goal']).describe('Action to perform'),
          goal: z.string().optional().describe('Goal for update-goal'),
        }),
        execute: async (params) => {
          const result = await this.toolProxy.executeToolCall({
            type: 'tool_call',
            id: `call_${Date.now()}`,
            toolName: 'project_context',
            parameters: params,
          });
          return result.success ? (result.result as string) : `Error: ${result.error}`;
        },
      }),
    };
  }

  async chat(messages: any[]) {
    return streamText({
      model: this.model,
      system: this.systemPrompt,
      messages,
      tools: this.getTools() as any,
      maxSteps: 10,
    } as any);
  }
}
