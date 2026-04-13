import { GeminiAgent } from './src/lib/gemini-agent.js';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { join } from 'node:path';
import { writeFile, unlink, access } from 'node:fs/promises';

dotenv.config();

async function runTest(name: string, fn: () => Promise<void>) {
  process.stdout.write(chalk.cyan(`[TEST] ${name.padEnd(40)} `));
  try {
    await fn();
    console.log(chalk.green('PASSED ✅'));
    return true;
  } catch (error) {
    console.log(chalk.red('FAILED ❌'));
    console.error(chalk.dim(`       Error: ${error instanceof Error ? error.message : String(error)}`));
    return false;
  }
}

async function verify() {
  console.log(chalk.bold.magenta('\n🚀 Local Mind Verification Suite\n'));
  
  const results = {
    env: false,
    ai: false,
    files: false,
    search: false,
    shell: false,
    context: false
  };

  const agent = new GeminiAgent();
  const tools: any = agent.getTools();

  // 1. Environment Check
  results.env = await runTest('Environment Variables', async () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
    if (!process.env.MODEL_ID) throw new Error('MODEL_ID missing');
  });

  // 2. AI Core Check
  results.ai = await runTest('AI Reasoning (Gemini API)', async () => {
    const response = await agent.chat([{ role: 'user', content: 'Say "READY"' }]);
    let fullText = '';
    for await (const chunk of response.textStream) {
      fullText += chunk;
    }
    if (!fullText.toUpperCase().includes('READY')) {
      throw new Error(`Unexpected AI response: ${fullText}`);
    }
  });

  // 3. File Tools Check
  results.files = await runTest('File Tools (Write/Read/Delete)', async () => {
    const testPath = 'smoke_test.tmp';
    const testContent = 'Local Mind Smoke Test ' + Date.now();
    
    // Write
    const writeRes = await tools.write_file.execute({ path: testPath, content: testContent });
    if (writeRes.includes('Error')) throw new Error(writeRes);
    
    // Read
    const readRes = await tools.read_file.execute({ path: testPath });
    if (!readRes.includes(testContent)) throw new Error(`Read mismatch: ${readRes}`);
    
    // Delete
    const delRes = await tools.delete_file.execute({ path: testPath });
    if (delRes.includes('Error')) throw new Error(delRes);
  });

  // 4. Search Tools Check
  results.search = await runTest('Search Tools (Grep/Find)', async () => {
    const testPath = 'search_test.tmp';
    await writeFile(testPath, 'TARGET_STRING_123');
    
    try {
        // Grep
        const grepRes = await tools.grep_search.execute({ pattern: 'TARGET_STRING_123' });
        if (!grepRes.includes(testPath)) throw new Error('Grep failed to find string');
        
        // Find
        const findRes = await tools.find_files.execute({ pattern: 'search_test.tmp' });
        if (!findRes.includes(testPath)) throw new Error('Find failed to find file');
    } finally {
        await unlink(testPath);
    }
  });

  // 5. Shell Tools Check
  results.shell = await runTest('Shell Tools (Run Command)', async () => {
    const nodeRes = await tools.run_command.execute({ command: 'node -v' });
    if (!nodeRes.includes('v') || nodeRes.includes('Error')) throw new Error(nodeRes);
    
    const gitRes = await tools.run_command.execute({ command: 'git --version' });
    if (!gitRes.includes('git version') || gitRes.includes('Error')) throw new Error(gitRes);
  });

  // 6. Context Tools Check
  results.context = await runTest('Context Tools (Work Goal)', async () => {
    const goal = 'Testing Local Mind';
    await tools.set_work_context.execute({ goal, status: 'testing' });
    
    const contextRes = await tools.get_work_context.execute({ includeHistory: false });
    if (!contextRes.includes(goal)) throw new Error(`Context retrieval failed: ${contextRes}`);
  });

  console.log('\n' + chalk.bold.magenta('📊 Verification Summary'));
  const allPassed = Object.values(results).every(v => v);
  
  if (allPassed) {
    console.log(chalk.green.bold('\nALL SYSTEMS OPERATIONAL! Local Mind is ready for deployment. ✨\n'));
  } else {
    console.log(chalk.red.bold('\nSOME TESTS FAILED. Please review the errors above. ⚠️\n'));
    process.exit(1);
  }
}

verify().catch(err => {
  console.error(chalk.red('\nCRITICAL FAILURE during verification:'));
  console.error(err);
  process.exit(1);
});
