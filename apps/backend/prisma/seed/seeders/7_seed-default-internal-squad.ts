import { PrismaClient } from '@prisma/client';
import consola from 'consola';

export async function seedDefaultInternalSquad(prisma: PrismaClient) {
    const existingInternalSquad = await prisma.internalSquads.findFirst();
    if (existingInternalSquad) {
        consola.info('Default internal squad already exists');
        return;
    }

    const res = await prisma.internalSquads.create({
        data: {
            name: 'Default-Squad',
            uuid: '00000000-0000-0000-0000-000000000000',
        },
    });

    if (!res) {
        consola.error('Failed to create default internal squad');
        process.exit(1);
    }

    consola.success('Default internal squad seeded');
}
