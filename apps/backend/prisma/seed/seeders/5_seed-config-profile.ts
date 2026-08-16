import { PrismaClient } from '@prisma/client';
import consola from 'consola';

import { XRAY_DEFAULT_CONFIG } from '../default';
import { syncInbounds } from './6_sync-inbounds';

export async function seedDefaultConfigProfile(prisma: PrismaClient) {
    consola.start('Seeding default config profile...');

    const existingConfig = await prisma.configProfiles.findFirst();

    if (existingConfig) {
        consola.info('Default config profile already seeded');
        return;
    }

    const config = await prisma.configProfiles.create({
        data: {
            name: 'Default-Profile',
            config: XRAY_DEFAULT_CONFIG,
            uuid: '00000000-0000-0000-0000-000000000000',
        },
    });
    if (!config) {
        consola.error('Failed to create default config profile');
        process.exit(1);
    }

    await syncInbounds(prisma);

    consola.success('Default config profile seeded');
}
