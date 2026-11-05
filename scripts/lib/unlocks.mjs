// Token unlock schedules from free, keyless sources (see DECISIONS.md › Unlocks).
//
// Route 1: DefiLlama's open-source emissions adapters (github.com/DefiLlama/emissions-adapters).
// Route 2: on-chain vesting contracts read through free public RPC endpoints.
// Route 3: a hand-checked unlocks.json built from each project's own docs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export const EMISSIONS_REPO = 'https://github.com/DefiLlama/emissions-adapters';

/**
 * Route 1: can the emissions-adapters repo be cloned anonymously? Runs outside this
 * repository's checkout with credential helpers off, so it sees exactly what the public
 * sees (and never sends this repository's token anywhere). If it can, list the adapter
 * files for the tracked tokens.
 */
export async function probeEmissionsRepo({ names = [], printFiles = false } = {}) {
  const fetchedAt = new Date().toISOString();
  if (process.env.UNLOCKS_REPO_PROBE === '0') return { ok: false, skipped: true, error: 'Skipped (UNLOCKS_REPO_PROBE=0)', fetchedAt };
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const cwd = mkdtempSync(join(tmpdir(), 'emissions-'));
  const git = (args, timeout = 60000) => run('git', ['-c', 'credential.helper=', ...args], { cwd, env, timeout, maxBuffer: 8 << 20 });
  try {
    const { stdout } = await git(['ls-remote', EMISSIONS_REPO, 'HEAD'], 30000);
    const sha = stdout.trim().split(/\s+/)[0] || null;
    await git(['clone', '--quiet', '--depth', '1', EMISSIONS_REPO, 'repo'], 120000);
    const root = join(cwd, 'repo');
    const top = readdirSync(root).sort();
    const protoDir = join(root, 'protocols');
    const all = existsSync(protoDir) ? readdirSync(protoDir) : [];
    const wanted = names.map((n) => String(n).toLowerCase()).filter((n) => n.length >= 3);
    const files = all.filter((f) => wanted.some((n) => f.toLowerCase().includes(n))).sort();
    if (printFiles) {
      const pkg = existsSync(join(root, 'package.json')) ? readFileSync(join(root, 'package.json'), 'utf8') : '(no package.json)';
      console.log(`   ↳ emissions-adapters @ ${sha}: top level ${JSON.stringify(top)}; ${all.length} protocol files`);
      console.log(`   ↳ package.json: ${pkg.slice(0, 1500)}`);
      for (const f of files.slice(0, 14)) {
        const p = join(protoDir, f);
        const body = existsSync(p) && !f.includes('.') ? readdirSync(p).join(', ') : readFileSync(p, 'utf8');
        console.log(`   ↳ ---- protocols/${f} ----\n${String(body).slice(0, 4000)}`);
      }
    }
    return { ok: true, sha, top, protocolCount: all.length, files, fetchedAt };
  } catch (e) {
    const msg = String(e.stderr || e.message || e).trim().split('\n').filter(Boolean).pop() || 'git failed';
    return { ok: false, error: msg.slice(0, 240), fetchedAt };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
