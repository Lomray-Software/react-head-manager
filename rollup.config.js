import typescript from 'rollup-plugin-ts';
import terser from '@rollup/plugin-terser';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import copy from 'rollup-plugin-copy';

const dest = 'lib';

export default {
  input: [
    'src/index.ts',
    'src/server/index.ts',
  ],
  output: {
    dir: dest,
    format: 'es',
    sourcemap: true,
    preserveModules: true,
    preserveModulesRoot: 'src',
    exports: 'auto',
  },
  external: [
    '@lomray/consistent-suspense',
    'html-react-parser',
  ],
  plugins: [
    typescript({
      tsconfig: resolvedConfig => ({
        ...resolvedConfig,
        declaration: true,
        importHelpers: true,
      }),
    }),
    peerDepsExternal({
      includeDependencies: true,
    }),
    terser(),
    copy({
      targets: [
        { src: 'package.json', dest: dest },
        { src: 'README.md', dest: dest },
        { src: 'LICENSE', dest: dest },
      ]
    })
  ],
};
