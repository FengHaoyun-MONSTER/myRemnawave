import { Badge, Group, Stack, Text } from '@mantine/core'
import { GetUserAccessibleNodesCommand } from '@remnawave/backend-contract'
import { TbCirclesRelation, TbServer } from 'react-icons/tb'

import { CountryFlag } from '@shared/ui/get-country-flag'
import { SectionCard } from '@shared/ui/section-card'

type ActiveNode = GetUserAccessibleNodesCommand.Response['response']['activeNodes'][number]

export function UserAccessibleNodesTree({ activeNodes }: { activeNodes: ActiveNode[] }) {
    return (
        <Stack gap="xs">
            {activeNodes.map((node) => (
                <SectionCard.Root key={node.uuid} p="sm">
                    <SectionCard.Section>
                        <Group gap="sm" wrap="nowrap">
                            <TbServer size={18} />
                            <CountryFlag countryCode={node.countryCode} />
                            <Text fw={600} size="sm" truncate="end">
                                {node.nodeName}
                            </Text>
                            <Badge color={node.isPublished ? 'teal' : 'gray'}>
                                {node.protocolKey ?? 'UNMANAGED'}
                            </Badge>
                            <Group gap={4} ml="auto">
                                <TbCirclesRelation size={15} />
                                <Text c="dimmed" size="xs">
                                    {node.activeSquads.map((squad) => squad.squadName).join(', ')}
                                </Text>
                            </Group>
                        </Group>
                    </SectionCard.Section>
                </SectionCard.Root>
            ))}
        </Stack>
    )
}
