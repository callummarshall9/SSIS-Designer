import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    root: path.resolve(__dirname),
    build: {
        outDir: path.resolve(__dirname, '..', 'out', 'webview'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'index.html'),
            output: {
                entryFileNames: 'main.js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]',
            },
        },
    },
    base: './',
});
