// Runs a shell command the way a terminal would and keeps what it printed, with the time of every line, for the
// terminal shots. With tty: true it runs under `script` (a pseudo-terminal), so tools print their own colours.
// Refuses output that carries an e-mail address, and a `git log` / `git show` without --format.

import { spawn } from 'node:child_process';

export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]/;

/** @returns {Promise<{cmd:string, cwd:string, exit:number, ms:number, at:string, lines:{t:number,text:string}[], out:string}>} */
export function run(cmd, { cwd, tty = false, env = {}, cols = 200, echo = false } = {}) {
  if (/\bgit\s+(log|show)\b/.test(cmd) && !/--format='%h %s'/.test(cmd)) throw new Error(`refused: "${cmd}" prints the author line; use --format='%h %s'`);
  const t0 = Date.now();
  const argv = tty ? ['script', ['-qefc', `stty cols ${cols} rows 60; ${cmd}`, '/dev/null']] : ['bash', ['-c', cmd]];
  const child = spawn(argv[0], argv[1], { cwd, env: { ...process.env, TERM: 'xterm-256color', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  const take = (chunk) => {
    if (echo) process.stdout.write(chunk);
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push({ t: Date.now() - t0, text: clean(buf.slice(0, i)) });
      buf = buf.slice(i + 1);
    }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (buf.length) lines.push({ t: Date.now() - t0, text: clean(buf) });
      while (lines.length && lines.at(-1).text === '') lines.pop();
      const out = lines.map((l) => l.text).join('\n');
      if (EMAIL.test(out)) return reject(new Error(`refused: the output of "${cmd}" contains an e-mail address`));
      resolve({ cmd, cwd, exit: code ?? 1, ms: Date.now() - t0, at: new Date(t0).toISOString(), lines, out });
    });
  });
}

/** A line as the terminal leaves it: a carriage return overwrites (progress meters), CR before LF is dropped. */
function clean(s) {
  s = s.replace(/\r+$/, '');
  // "Go to column 1" (a spinner redrawing itself) acts like a carriage return.
  s = s.replace(/\x1b\[1?G/g, '\r');
  if (s.includes('\r')) s = s.split('\r').filter((x) => x.length).at(-1) ?? '';
  // A spinner frame left alone on its line (npm's, when the process exits) is gone from a real terminal.
  if (/^[\u2800-\u28ff\s]+$/.test(s.replace(/\x1b\[[0-9;]*m/g, ''))) s = '';
  // Cursor movement and erase codes from progress meters, keypad and charset modes; colours (SGR, ending in m) stay.
  return s
    .replace(/\x1b\[[0-9;?]*[ABCDEFGHJKSTfhlnsu]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '');
}
