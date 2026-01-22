import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY || 'http://127.0.0.1:3434';

  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api': apiTarget,
        '/status': apiTarget
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  };
});
