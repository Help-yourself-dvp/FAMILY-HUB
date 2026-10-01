#!/usr/bin/env node
// §10 п.5 DoD: единый источник версии — version.json. Все дубли обязаны совпадать.
import { readFileSync } from 'node:fs';

const canonical = JSON.parse(readFileSync('version.json', 'utf8')).version;
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;

const problems = [];
if (pkg !== canonical) problems.push(`package.json = ${pkg}, ожидается ${canonical}`);

const manifest = readFileSync('public/manifest.webmanifest', 'utf8');
const m = /"version"\s*:\s*"([^"]+)"/.exec(manifest);
if (m && m[1] !== canonical)
  problems.push(`manifest.webmanifest = ${m[1]}, ожидается ${canonical}`);

if (problems.length) {
  console.error('РАССИНХРОН ВЕРСИЙ (version.json — единственный источник):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`Версии совпадают: ${canonical}`);
