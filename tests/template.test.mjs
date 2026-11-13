import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { compile } from '@vue/compiler-dom';

test('La plantilla del frontend compila sin expresiones inválidas', async () => {
  const source = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
  compile(source, { onError(error) { throw error; } });
});
