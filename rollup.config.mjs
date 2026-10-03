import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/main.user.ts',
  // wmekit-wme-ui is loaded at runtime by the header's @require (the WMEKitUI global),
  // so it's only installed for its types and never bundled.
  external: ['wmekit-wme-ui'],
  output: {
    file: '.out/main.user.js',
    format: 'iife',
    globals: { 'wmekit-wme-ui': 'WMEKitUI' },
  },
  plugins: [typescript()],
};
