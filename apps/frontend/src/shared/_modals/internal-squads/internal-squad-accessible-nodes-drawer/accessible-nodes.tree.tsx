import { Badge, Group, Stack, Text } from '@mantine/core'
import { GetInternalSquadAccessibleNodesCommand } from '@remnawave/backend-contract'
import { TbServer } from 'react-icons/tb'

import { CountryFlag } from '@shared/ui/get-country-flag'
import { SectionCard } from '@shared/ui/section-card'

type AccessibleNode =
    GetInternalSquadAccessibleNodesCommand.Response['response']['accessibleNodes'][number]

export function AccessibleNodesTree({ accessibleNodes }: { accessibleNodes: AccessibleNode[] }) {
    return (
        <Stack gap="xs">
            {accessibleNodes.map((node) => (
                <SectionCard.Root key={node.uuid} p="sm">
                    <SectionCard.Section>
                        <Group gap="sm" wrap="nowrap">
                            <TbServer size={18} />
                            <CountryFlag countryCode={node.countryCode} />
                            <Text fw={600} size="sm" truncate="end">
                                {node.nodeName}
                            </Text>
                            <Badge color={node.isPublished ? 'teal' : 'gray'} ml="auto">
                                {node.protocolKey ?? 'UNMANAGED'}
                            </Badge>
                            <Badge color={node.isPublished ? 'teal' : 'yellow'} variant="light">
                                {node.lifecycleState}
                            </Badge>
                        </Group>
                    </SectionCard.Section>
                </SectionCard.Root>
            ))}
        </Stack>
    )
}
