// Builds src/assets/elk/elk.glb from the Blender export in Brand/3D.
//
//   node scripts/build-elk-model.mjs [source.glb] [out.glb] [--report]
//
// The output lives under src/assets, not public/, so Vite fingerprints it and
// nginx can serve it with the year-long immutable cache it already gives
// /_astro/. A model in public/ would keep its name across rebuilds and sit
// stale in browsers for as long as its max-age allowed.
//
// The source export carries a lot the site never uses. What Spline actually
// played, established by reading its runtime rather than guessing:
//   - one clip, "Action.001" — 201 channels baked onto 67 bones, 8.33 s;
//   - none of the other 13 clips. Twelve of them animate IK targets and
//     helper empties ("L Z NOGA", "Empty.004"…), which do nothing in three.js
//     because there is no IK solver; the thirteenth moves the mesh node itself
//     and Spline never triggers it.
// So this keeps the skinned mesh, its skeleton and that one clip, drops the
// rest, and compresses what is left.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { gzipSync } from 'node:zlib';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const report = args.includes('--report');
const [SRC = '../Brand/3D/los_anime1.glb', OUT = 'src/assets/elk/elk.glb'] = args.filter((a) => !a.startsWith('--'));

const KEEP_CLIP = 'Action.001';

// Spline split the one mesh into three materials. Primitives are identified
// by vertex count — the colours in the export are Blender's, not the site's.
const MATERIAL_BY_VERTEX_COUNT = { 3377: 'body', 407: 'legs', 618: 'horns' };

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function readTrimmed() {
  const doc = await io.read(SRC);
  const root = doc.getRoot();

  for (const anim of root.listAnimations()) {
    if (anim.getName() !== KEEP_CLIP) anim.dispose();
  }
  if (root.listAnimations().length !== 1) {
    throw new Error(`expected exactly one "${KEEP_CLIP}" clip, found ${root.listAnimations().length}`);
  }

  // A node is dead weight when nothing renders through it: it is not a joint,
  // carries no mesh or skin, and has no descendant that does.
  const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
  const matters = (node) =>
    joints.has(node) || !!node.getMesh() || !!node.getSkin() || node.listChildren().some(matters);
  for (const node of root.listNodes()) {
    if (!matters(node)) node.dispose();
  }

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const count = prim.getAttribute('POSITION').getCount();
      const name = MATERIAL_BY_VERTEX_COUNT[count];
      if (!name) throw new Error(`unexpected primitive with ${count} vertices — the source mesh changed`);
      prim.getMaterial().setName(name);
      // Vertex colours are exported but never read: Spline's compiled shader
      // takes colour from a uniform, and so does ours.
      const color = prim.getAttribute('COLOR_0');
      if (color) {
        prim.setAttribute('COLOR_0', null);
        color.dispose();
      }
    }
  }

  await doc.transform(resample(), prune(), dedup());
  return doc;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const sizeOf = (bytes) => `${kb(bytes.byteLength).padStart(9)} raw, ${kb(gzipSync(bytes, { level: 9 }).byteLength).padStart(9)} gzip`;

if (report) {
  console.log(`source ${SRC}: ${kb(statSync(SRC).size)}`);
  const variants = {
    trimmed: [],
    quantized: [quantize()],
    meshopt: [meshopt({ encoder: MeshoptEncoder, level: 'high' })],
  };
  for (const [name, transforms] of Object.entries(variants)) {
    const doc = await readTrimmed();
    if (transforms.length) await doc.transform(...transforms);
    const bytes = await io.writeBinary(doc);
    const r = doc.getRoot();
    const anim = r.listAnimations()[0];
    console.log(
      `${name.padEnd(10)} ${sizeOf(bytes)} | nodes ${r.listNodes().length}, ` +
        `clip "${anim.getName()}" ${anim.listChannels().length} ch, ` +
        `extensions ${JSON.stringify(r.listExtensionsUsed().map((e) => e.extensionName))}`,
    );
  }
} else {
  const doc = await readTrimmed();
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const bytes = await io.writeBinary(doc);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  // The exact size the scene divides by to report download progress. With gzip
  // the server sends no Content-Length, so the browser cannot compute a fraction
  // itself — and three's FileLoader counts decoded bytes, which is this number.
  const META = OUT.replace(/\.glb$/, '.meta.json');
  writeFileSync(META, `${JSON.stringify({ bytes: bytes.byteLength }, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${sizeOf(bytes)}`);
  console.log(`wrote ${META}: { bytes: ${bytes.byteLength} }`);
}
