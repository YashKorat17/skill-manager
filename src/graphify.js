import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './claude.js';

/**
 * Finds (or installs) a Python interpreter that has the `graphify` package.
 * Only handles the code-only pipeline - AST extraction needs no LLM, so this
 * is the one part of graphify a plain npm package can drive on its own.
 * Docs/papers/images need semantic extraction via an LLM subagent, which is
 * the `/graphify` skill's job, not this package's.
 */
export async function ensureGraphifyPython() {
  for (const candidate of pythonCandidates()) {
    const check = await run(candidate, ['-c', 'import graphify'], { quiet: true });
    if (check.code === 0) return candidate;
  }

  const pip = pythonCandidates()[0] ?? 'python3';
  const install = await run(pip, ['-m', 'pip', 'install', '-q', 'graphifyy'], { quiet: true });
  if (install.code !== 0) {
    throw new Error(`could not install graphifyy: ${install.stderr || install.stdout}`);
  }

  for (const candidate of pythonCandidates()) {
    const check = await run(candidate, ['-c', 'import graphify'], { quiet: true });
    if (check.code === 0) return candidate;
  }

  throw new Error('graphifyy installed but no Python interpreter can import it');
}

function pythonCandidates() {
  return process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
}

/**
 * Runs the non-LLM half of graphify's pipeline: detect -> AST extract -> build
 * -> cluster -> analyze -> export graph.json + GRAPH_REPORT.md + graph.html.
 * Community labels default to "Community N" since naming them well needs an
 * LLM - that step is what the full `/graphify` skill adds on top of this.
 */
export async function buildCodeGraph(cwd = process.cwd(), { onData } = {}) {
  const python = await ensureGraphifyPython();
  const outDir = path.join(cwd, 'graphify-out');
  fs.mkdirSync(outDir, { recursive: true });

  const scriptPath = path.join(os.tmpdir(), `skill-manager-graphify-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, PIPELINE_SCRIPT, 'utf8');

  try {
    const result = await run(python, [scriptPath, cwd], { onData, quiet: !onData });
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || 'graphify pipeline failed');
    }

    const summaryLine = result.stdout.trim().split('\n').filter(Boolean).pop() ?? '{}';
    return JSON.parse(summaryLine);
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }
}

const PIPELINE_SCRIPT = `
import json, sys
from pathlib import Path

cwd = Path(sys.argv[1])
out_dir = cwd / 'graphify-out'
out_dir.mkdir(exist_ok=True)

from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json

detection = detect(cwd)
code_files = []
for f in detection.get('files', {}).get('code', []):
    p = Path(f)
    code_files.extend(collect_files(p) if p.is_dir() else [p])

if not code_files:
    print(json.dumps({'error': 'no code files found'}))
    sys.exit(1)

extraction = extract(code_files, cache_root=cwd)
G = build_from_json(extraction, root=str(cwd), directed=False)
if G.number_of_nodes() == 0:
    print(json.dumps({'error': 'graph is empty'}))
    sys.exit(1)

communities = cluster(G)
cohesion = score_all(G, communities)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
labels = {cid: f'Community {cid}' for cid in communities}
questions = suggest_questions(G, communities, labels)
tokens = {'input': extraction.get('input_tokens', 0), 'output': extraction.get('output_tokens', 0)}

wrote = to_json(G, communities, str(out_dir / 'graph.json'))
report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, str(cwd), suggested_questions=questions)
(out_dir / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')

import subprocess
subprocess.run([sys.executable, '-m', 'graphify', 'export', 'html'], cwd=str(cwd), check=False)

print(json.dumps({
    'nodes': G.number_of_nodes(),
    'edges': G.number_of_edges(),
    'communities': len(communities),
    'wrote': bool(wrote),
    'htmlExists': (out_dir / 'graph.html').exists()
}))
`;
