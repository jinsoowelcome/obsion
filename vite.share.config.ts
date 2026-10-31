import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'publish-service/generated',emptyOutDir:true,lib:{entry:'src/ShareEditor.ts',formats:['es'],fileName:()=> 'editor.js'}}});
