import NiceModal, { useModal } from '@ebay/nice-modal-react'
import {
    Badge,
    Button,
    Checkbox,
    Drawer,
    Group,
    Paper,
    ScrollArea,
    Stack,
    Text,
    TextInput
} from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { TbCirclesRelation, TbSearch, TbServer } from 'react-icons/tb'

import { useNiceMantineModal } from '@shared/_modals/use-nice-modal'
import { queryClient } from '@shared/api'
import {
    internalSquadsQueryKeys,
    useGetInternalSquad,
    useGetNodes,
    useUpdateInternalSquad
} from '@shared/api/hooks'
import { LoadingScreen } from '@shared/ui'
import { BaseOverlayHeader } from '@shared/ui/overlays/base-overlay-header'

interface IProps {
    squadUuid: string
}

export const InternalSquadsInboundsDrawer = NiceModal.create((props: IProps) => {
    const modal = useModal()
    const { modalProps } = useNiceMantineModal({ modal, drawer: true })
    const { data: internalSquad, isLoading: isSquadLoading } = useGetInternalSquad({
        route: { uuid: props.squadUuid }
    })
    const { data: nodes, isLoading: isNodesLoading } = useGetNodes()
    const [search, setSearch] = useState('')
    const [selectedNodes, setSelectedNodes] = useState<string[]>([])

    useEffect(() => {
        if (internalSquad) setSelectedNodes(internalSquad.nodes.map((node) => node.uuid))
    }, [internalSquad])

    const filteredNodes = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return nodes ?? []
        return (nodes ?? []).filter(
            (node) =>
                node.name.toLowerCase().includes(query) ||
                node.protocolKey?.toLowerCase().includes(query) ||
                node.address.toLowerCase().includes(query)
        )
    }, [nodes, search])

    const { mutate: updateInternalSquad, isPending } = useUpdateInternalSquad({
        mutationFns: {
            onSuccess: (data) => {
                queryClient.setQueryData(
                    internalSquadsQueryKeys.getInternalSquad({ uuid: props.squadUuid }).queryKey,
                    data
                )
                queryClient.invalidateQueries({
                    queryKey: internalSquadsQueryKeys.getInternalSquads.queryKey
                })
            }
        }
    })

    const loading = isSquadLoading || isNodesLoading

    return (
        <Drawer
            {...modalProps}
            position="right"
            size="560px"
            title={
                <BaseOverlayHeader
                    iconColor="teal"
                    IconComponent={TbCirclesRelation}
                    iconVariant="soft"
                    title="Assign logical nodes"
                />
            }
        >
            {loading ? (
                <LoadingScreen />
            ) : (
                <Stack gap="md">
                    <Text c="dimmed" size="sm">
                        Node grants are independent of config profiles and inbound tags. Users in
                        this squad receive the union of the logical nodes selected here.
                    </Text>
                    <TextInput
                        leftSection={<TbSearch size={16} />}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        placeholder="Search by node, protocol, or address"
                        value={search}
                    />
                    <Checkbox.Group onChange={setSelectedNodes} value={selectedNodes}>
                        <ScrollArea h="55vh" offsetScrollbars>
                            <Stack gap="xs" pr="sm">
                                {filteredNodes.map((node) => (
                                    <Paper key={node.uuid} p="sm" withBorder>
                                        <Group align="center" gap="sm" wrap="nowrap">
                                            <Checkbox value={node.uuid} />
                                            <TbServer size={18} />
                                            <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                                                <Text fw={600} size="sm" truncate="end">
                                                    {node.name}
                                                </Text>
                                                <Text c="dimmed" size="xs" truncate="end">
                                                    {node.address}
                                                </Text>
                                            </Stack>
                                            <Badge color={node.isPublished ? 'teal' : 'gray'}>
                                                {node.protocolKey ?? 'UNMANAGED'}
                                            </Badge>
                                        </Group>
                                    </Paper>
                                ))}
                            </Stack>
                        </ScrollArea>
                    </Checkbox.Group>
                    <Group justify="space-between">
                        <Text c="dimmed" size="sm">
                            {selectedNodes.length} node(s) selected
                        </Text>
                        <Button
                            loading={isPending}
                            onClick={() =>
                                updateInternalSquad({
                                    variables: { uuid: props.squadUuid, nodes: selectedNodes }
                                })
                            }
                        >
                            Save node grants
                        </Button>
                    </Group>
                </Stack>
            )}
        </Drawer>
    )
})
