import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const output = 'app/build/generated/web';
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['web/app.js'],
  bundle: true,
  target: 'chrome109',
  minify: true,
  legalComments: 'eof',
  outfile: output + '/app.js'
});
for (const name of ['index.html', 'style.css']) {
  await cp('web/' + name, output + '/' + name);
}
await cp('node_modules/leaflet/dist/leaflet.css', output + '/leaflet.css');
await cp('node_modules/leaflet/dist/images', output + '/images', { recursive: true });
await cp('node_modules/leaflet/LICENSE', output + '/leaflet-LICENSE.txt');
