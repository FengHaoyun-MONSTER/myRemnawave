import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@common': fileURLToPath(new URL('./src/common', import.meta.url)),
            '@contract': fileURLToPath(new URL('./libs/contract', import.meta.url)),
            '@integration-modules': fileURLToPath(
                new URL('./src/integration-modules', import.meta.url),
            ),
            '@libs/contracts': fileURLToPath(new URL('./libs/contract', import.meta.url)),
            '@libs/subscription-page': fileURLToPath(
                new URL('./libs/subscription-page', import.meta.url),
            ),
            '@modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
            '@queue': fileURLToPath(new URL('./src/queue', import.meta.url)),
            '@scheduler': fileURLToPath(new URL('./src/scheduler', import.meta.url)),
        },
    },
});
