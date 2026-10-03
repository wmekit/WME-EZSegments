import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/main.user.ts',
  output: {
    file: '.out/main.user.js',
    format: 'iife',
  },
  plugins: [typescript()],
};
