import {
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    Code,
    CopyButton,
    Grid,
    Group,
    Modal,
    MultiSelect,
    NumberInput,
    Select,
    SimpleGrid,
    Stack,
    Stepper,
    Switch,
    Text,
    TextInput,
    Title
} from '@mantine/core'
import { MachineSchema, ProvisionMachineCommand } from '@remnawave/backend-contract'
import { ReactNode, useMemo, useState } from 'react'
import { TbCertificate, TbCloudLock, TbPlus, TbServer, TbShieldCheck } from 'react-icons/tb'
import { z } from 'zod'

import { getBackendDomain, queryClient } from '@shared/api'
import {
    machinesQueryKeys,
    nodesQueryKeys,
    useCreateMachine,
    useGetInternalSquads,
    useGetMachines,
    useGetNodes,
    useProvisionMachine,
    usePublishMachine,
    useRetryMachine,
    useRotateMachineEnrollmentToken
} from '@shared/api/hooks'
import { LoadingScreen, Page, PageHeaderShared } from '@shared/ui'

type Machine = z.infer<typeof MachineSchema>
type WizardMachine = { machine: Machine; enrollmentToken?: string }
type ProtocolSelection = Record<'HYSTERIA2' | 'VLESS_REALITY' | 'VLESS_TLS_VISION', boolean>
type CertificateMode = 'HTTP_01' | 'IMPORT_EXISTING'

const AGENT_VERSION = 'v0.1.0'

const initialProtocols: ProtocolSelection = {
    VLESS_REALITY: true,
    VLESS_TLS_VISION: true,
    HYSTERIA2: true
}

export function MachinesPage() {
    const { data: machines, isLoading } = useGetMachines()
    const { data: nodes } = useGetNodes()
    const { data: squads } = useGetInternalSquads()
    const [opened, setOpened] = useState(false)
    const [activeStep, setActiveStep] = useState(0)
    const [wizardMachine, setWizardMachine] = useState<WizardMachine | null>(null)
    const [provisionedNodeUuids, setProvisionedNodeUuids] = useState<string[]>([])

    const [name, setName] = useState('')
    const [address, setAddress] = useState('')
    const [countryCode, setCountryCode] = useState('XX')
    const [protocols, setProtocols] = useState<ProtocolSelection>(initialProtocols)
    const [realityServerName, setRealityServerName] = useState('www.microsoft.com')
    const [realityTarget, setRealityTarget] = useState('www.microsoft.com:443')
    const [realityPort, setRealityPort] = useState(443)
    const [tlsDomain, setTlsDomain] = useState('')
    const [tlsEmail, setTlsEmail] = useState('')
    const [tlsCertificateMode, setTlsCertificateMode] = useState<CertificateMode>('HTTP_01')
    const [tlsCertificatePath, setTlsCertificatePath] = useState('')
    const [tlsPrivateKeyPath, setTlsPrivateKeyPath] = useState('')
    const [tlsPort, setTlsPort] = useState(8443)
    const [hysteriaDomain, setHysteriaDomain] = useState('')
    const [hysteriaEmail, setHysteriaEmail] = useState('')
    const [hysteriaCertificateMode, setHysteriaCertificateMode] =
        useState<CertificateMode>('HTTP_01')
    const [hysteriaCertificatePath, setHysteriaCertificatePath] = useState('')
    const [hysteriaPrivateKeyPath, setHysteriaPrivateKeyPath] = useState('')
    const [hysteriaPort, setHysteriaPort] = useState(443)
    const [enableWarp, setEnableWarp] = useState(true)
    const [selectedSquads, setSelectedSquads] = useState<string[]>([])

    const currentMachine = machines?.find((machine) => machine.uuid === wizardMachine?.machine.uuid)
    const machineNodes = (nodes ?? []).filter(
        (node) => node.machineUuid === wizardMachine?.machine.uuid
    )
    const targetNodeUuids =
        provisionedNodeUuids.length > 0
            ? provisionedNodeUuids
            : machineNodes.map((node) => node.uuid)
    const readyNodes = machineNodes.filter(
        (node) =>
            targetNodeUuids.includes(node.uuid) &&
            ['CONFIG_VALIDATED', 'PUBLISHED'].includes(node.lifecycleState) &&
            node.appliedRevision === node.desiredRevision &&
            (node.certificateMode === null || node.certificateStatus === 'VALID')
    )

    const resetWizard = () => {
        setActiveStep(0)
        setWizardMachine(null)
        setProvisionedNodeUuids([])
        setName('')
        setAddress('')
        setCountryCode('XX')
        setProtocols(initialProtocols)
        setRealityServerName('www.microsoft.com')
        setRealityTarget('www.microsoft.com:443')
        setRealityPort(443)
        setTlsDomain('')
        setTlsEmail('')
        setTlsCertificateMode('HTTP_01')
        setTlsCertificatePath('')
        setTlsPrivateKeyPath('')
        setTlsPort(8443)
        setHysteriaDomain('')
        setHysteriaEmail('')
        setHysteriaCertificateMode('HTTP_01')
        setHysteriaCertificatePath('')
        setHysteriaPrivateKeyPath('')
        setHysteriaPort(443)
        setEnableWarp(true)
        setSelectedSquads([])
    }

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: machinesQueryKeys.getMachines.queryKey })
        queryClient.invalidateQueries({ queryKey: nodesQueryKeys.getAllNodes.queryKey })
    }

    const { mutate: createMachine, isPending: isCreating } = useCreateMachine({
        mutationFns: {
            onSuccess: (result) => {
                setWizardMachine({
                    machine: result.machine,
                    enrollmentToken: result.enrollmentToken
                })
                setActiveStep(1)
                refresh()
            }
        }
    })
    const { mutate: rotateToken, isPending: isRotating } = useRotateMachineEnrollmentToken({
        mutationFns: {
            onSuccess: (result) => {
                setWizardMachine({
                    machine: result.machine,
                    enrollmentToken: result.enrollmentToken
                })
                setActiveStep(1)
                setOpened(true)
                refresh()
            }
        }
    })
    const { mutate: provisionMachine, isPending: isProvisioning } = useProvisionMachine({
        mutationFns: {
            onSuccess: (result) => {
                setProvisionedNodeUuids(result.nodeUuids)
                setActiveStep(3)
                refresh()
            }
        }
    })
    const { mutate: publishMachine, isPending: isPublishing } = usePublishMachine({
        mutationFns: {
            onSuccess: () => {
                refresh()
                setOpened(false)
            }
        }
    })
    const { mutate: retryMachine, isPending: isRetrying } = useRetryMachine({
        mutationFns: {
            onSuccess: (result) => {
                setProvisionedNodeUuids(result.nodeUuids)
                setActiveStep(3)
                refresh()
            }
        }
    })

    const enrollmentCommand = useMemo(() => {
        if (!wizardMachine?.enrollmentToken) return ''
        const backend = String(getBackendDomain()).replace(/\/$/, '')
        const endpoint = `${backend}/api/machine-enrollment`
        const installer = `https://raw.githubusercontent.com/FengHaoyun-MONSTER/myRemnawave/${AGENT_VERSION}/apps/machine-agent/install.sh`
        return `curl -fsSL ${shellQuote(installer)} | sh -s -- --version ${shellQuote(AGENT_VERSION)} --panel-url ${shellQuote(endpoint)} --token ${shellQuote(wizardMachine.enrollmentToken)}`
    }, [wizardMachine])

    const buildProvisionRequest = (): ProvisionMachineCommand.RequestBody | null => {
        const requested: ProvisionMachineCommand.RequestBody['protocols'] = []
        if (protocols.VLESS_REALITY) {
            requested.push({
                protocol: 'VLESS_REALITY',
                externalPort: realityPort,
                serverName: realityServerName,
                target: realityTarget
            })
        }
        if (protocols.VLESS_TLS_VISION) {
            requested.push({
                protocol: 'VLESS_TLS_VISION',
                externalPort: tlsPort,
                certificate:
                    tlsCertificateMode === 'HTTP_01'
                        ? { mode: 'HTTP_01', domain: tlsDomain, email: tlsEmail }
                        : {
                              mode: 'IMPORT_EXISTING',
                              domain: tlsDomain,
                              certificatePath: tlsCertificatePath,
                              privateKeyPath: tlsPrivateKeyPath
                          }
            })
        }
        if (protocols.HYSTERIA2) {
            requested.push({
                protocol: 'HYSTERIA2',
                externalPort: hysteriaPort,
                certificate:
                    hysteriaCertificateMode === 'HTTP_01'
                        ? {
                              mode: 'HTTP_01',
                              domain: hysteriaDomain,
                              email: hysteriaEmail
                          }
                        : {
                              mode: 'IMPORT_EXISTING',
                              domain: hysteriaDomain,
                              certificatePath: hysteriaCertificatePath,
                              privateKeyPath: hysteriaPrivateKeyPath
                          }
            })
        }
        const parsed = ProvisionMachineCommand.RequestBodySchema.safeParse({
            protocols: requested,
            enableWarp
        })
        return parsed.success ? parsed.data : null
    }

    const openExisting = (machine: Machine) => {
        setWizardMachine({ machine })
        setProvisionedNodeUuids(
            (nodes ?? [])
                .filter((node) => node.machineUuid === machine.uuid)
                .map((node) => node.uuid)
        )
        setActiveStep(
            machine.agentCapabilities.length > 0 ? (machine.status === 'CONNECTED' ? 2 : 3) : 1
        )
        setOpened(true)
    }

    if (isLoading) return <LoadingScreen />

    const provisionRequest = buildProvisionRequest()
    const agentConnected = Boolean(currentMachine?.agentCapabilities.length)
    const selectedCount = Object.values(protocols).filter(Boolean).length

    return (
        <Page title="Machines">
            <PageHeaderShared
                actions={
                    <Button
                        leftSection={<TbPlus size={18} />}
                        onClick={() => {
                            resetWizard()
                            setOpened(true)
                        }}
                    >
                        Add machine
                    </Button>
                }
                description="Enroll once, then provision up to three isolated protocol nodes"
                icon={<TbServer size={24} />}
                title="Machines"
            />

            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
                {(machines ?? []).map((machine) => {
                    const childNodes = (nodes ?? []).filter(
                        (node) => node.machineUuid === machine.uuid
                    )
                    return (
                        <Card key={machine.uuid} padding="lg" shadow="sm" withBorder>
                            <Stack gap="sm">
                                <Group justify="space-between">
                                    <Title order={4}>{machine.name}</Title>
                                    <Badge color={statusColor(machine.status)}>
                                        {machine.status}
                                    </Badge>
                                </Group>
                                <Text c="dimmed" ff="monospace" size="sm">
                                    {machine.address}
                                </Text>
                                <Group gap="xs">
                                    {childNodes.map((node) => (
                                        <Badge
                                            color={node.isPublished ? 'teal' : 'gray'}
                                            key={node.uuid}
                                            variant="light"
                                        >
                                            {node.protocolKey}: {node.lifecycleState}
                                        </Badge>
                                    ))}
                                </Group>
                                <Group justify="space-between">
                                    <Text c="dimmed" size="xs">
                                        Agent {machine.agentVersion ?? 'not enrolled'} · WARP{' '}
                                        {machine.warpStatus}
                                    </Text>
                                    <Button
                                        onClick={() => openExisting(machine)}
                                        size="xs"
                                        variant="light"
                                    >
                                        Manage
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                    )
                })}
            </SimpleGrid>

            <Modal
                centered
                onClose={() => setOpened(false)}
                opened={opened}
                size="xl"
                title="Machine provisioning wizard"
            >
                <Stepper active={activeStep} allowNextStepsSelect={false}>
                    <Stepper.Step description="Physical server" label="Machine">
                        <Stack mt="lg">
                            <TextInput
                                label="Machine name"
                                maxLength={100}
                                onChange={(event) => setName(event.currentTarget.value)}
                                required
                                value={name}
                            />
                            <TextInput
                                description="Public IP address or management hostname"
                                label="Address"
                                onChange={(event) => setAddress(event.currentTarget.value)}
                                required
                                value={address}
                            />
                            <TextInput
                                label="Country code"
                                maxLength={2}
                                onChange={(event) =>
                                    setCountryCode(event.currentTarget.value.toUpperCase())
                                }
                                value={countryCode}
                            />
                            <Group justify="flex-end">
                                <Button
                                    disabled={name.trim().length < 3 || address.trim().length < 2}
                                    loading={isCreating}
                                    onClick={() =>
                                        createMachine({
                                            variables: {
                                                name,
                                                address,
                                                countryCode,
                                                tags: []
                                            }
                                        })
                                    }
                                >
                                    Create draft
                                </Button>
                            </Group>
                        </Stack>
                    </Stepper.Step>

                    <Stepper.Step description="One root command" label="Enroll">
                        <Stack mt="lg">
                            <Alert
                                color={agentConnected ? 'teal' : 'blue'}
                                icon={<TbShieldCheck />}
                            >
                                {agentConnected
                                    ? 'Machine Agent is connected with mutual TLS.'
                                    : 'Run this one-time command as root. It installs Docker and the pinned Agent, then enrolls without uploading SSH credentials or private keys.'}
                            </Alert>
                            {enrollmentCommand ? (
                                <>
                                    <Code block style={{ overflowWrap: 'anywhere' }}>
                                        {enrollmentCommand}
                                    </Code>
                                    <CopyButton value={enrollmentCommand}>
                                        {({ copied, copy }) => (
                                            <Button onClick={copy} variant="light">
                                                {copied ? 'Copied' : 'Copy enrollment command'}
                                            </Button>
                                        )}
                                    </CopyButton>
                                </>
                            ) : (
                                !agentConnected && (
                                    <Button
                                        loading={isRotating}
                                        onClick={() =>
                                            wizardMachine &&
                                            rotateToken({
                                                route: { uuid: wizardMachine.machine.uuid }
                                            })
                                        }
                                    >
                                        Issue a new one-time token
                                    </Button>
                                )
                            )}
                            <Group justify="flex-end">
                                <Button disabled={!agentConnected} onClick={() => setActiveStep(2)}>
                                    Continue
                                </Button>
                            </Group>
                        </Stack>
                    </Stepper.Step>

                    <Stepper.Step description="Protocols and certificates" label="Configure">
                        <Stack mt="lg">
                            <Alert icon={<TbCloudLock />}>
                                HTTP-01 is automatic with only a domain and email. You may instead
                                import an existing certificate from absolute paths on the Machine;
                                private keys never leave that server. Certificate directories remain
                                node-specific even though templates are shared.
                            </Alert>
                            <ProtocolToggle
                                checked={protocols.VLESS_REALITY}
                                label="VLESS + Reality + Vision"
                                onChange={(checked) =>
                                    setProtocols((value) => ({ ...value, VLESS_REALITY: checked }))
                                }
                            >
                                <Grid>
                                    <Grid.Col span={{ base: 12, sm: 4 }}>
                                        <NumberInput
                                            label="TCP port"
                                            min={1}
                                            onChange={(v) => setRealityPort(Number(v))}
                                            value={realityPort}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={{ base: 12, sm: 4 }}>
                                        <TextInput
                                            label="Camouflage SNI"
                                            onChange={(e) =>
                                                setRealityServerName(e.currentTarget.value)
                                            }
                                            value={realityServerName}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={{ base: 12, sm: 4 }}>
                                        <TextInput
                                            label="Camouflage target"
                                            onChange={(e) =>
                                                setRealityTarget(e.currentTarget.value)
                                            }
                                            value={realityTarget}
                                        />
                                    </Grid.Col>
                                </Grid>
                            </ProtocolToggle>
                            <ProtocolToggle
                                checked={protocols.VLESS_TLS_VISION}
                                label="VLESS + TLS + Vision"
                                onChange={(checked) =>
                                    setProtocols((value) => ({
                                        ...value,
                                        VLESS_TLS_VISION: checked
                                    }))
                                }
                            >
                                <Grid>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <NumberInput
                                            label="TCP port"
                                            min={1}
                                            onChange={(v) => setTlsPort(Number(v))}
                                            value={tlsPort}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <TextInput
                                            label="Certificate domain"
                                            onChange={(e) => setTlsDomain(e.currentTarget.value)}
                                            value={tlsDomain}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <Select
                                            allowDeselect={false}
                                            data={[
                                                { label: 'Automatic HTTP-01', value: 'HTTP_01' },
                                                {
                                                    label: 'Import local files',
                                                    value: 'IMPORT_EXISTING'
                                                }
                                            ]}
                                            label="Certificate mode"
                                            onChange={(value) =>
                                                setTlsCertificateMode(value as CertificateMode)
                                            }
                                            value={tlsCertificateMode}
                                        />
                                    </Grid.Col>
                                    {tlsCertificateMode === 'HTTP_01' ? (
                                        <Grid.Col span={{ base: 12, sm: 3 }}>
                                            <TextInput
                                                label="ACME email"
                                                onChange={(e) => setTlsEmail(e.currentTarget.value)}
                                                value={tlsEmail}
                                            />
                                        </Grid.Col>
                                    ) : (
                                        <>
                                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                                <TextInput
                                                    label="Full chain path"
                                                    onChange={(e) =>
                                                        setTlsCertificatePath(e.currentTarget.value)
                                                    }
                                                    placeholder="/etc/letsencrypt/live/example/fullchain.pem"
                                                    value={tlsCertificatePath}
                                                />
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                                <TextInput
                                                    label="Private key path"
                                                    onChange={(e) =>
                                                        setTlsPrivateKeyPath(e.currentTarget.value)
                                                    }
                                                    placeholder="/etc/letsencrypt/live/example/privkey.pem"
                                                    value={tlsPrivateKeyPath}
                                                />
                                            </Grid.Col>
                                        </>
                                    )}
                                </Grid>
                            </ProtocolToggle>
                            <ProtocolToggle
                                checked={protocols.HYSTERIA2}
                                label="Hysteria2 + TLS"
                                onChange={(checked) =>
                                    setProtocols((value) => ({ ...value, HYSTERIA2: checked }))
                                }
                            >
                                <Grid>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <NumberInput
                                            label="UDP port"
                                            min={1}
                                            onChange={(v) => setHysteriaPort(Number(v))}
                                            value={hysteriaPort}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <TextInput
                                            label="Certificate domain"
                                            onChange={(e) =>
                                                setHysteriaDomain(e.currentTarget.value)
                                            }
                                            value={hysteriaDomain}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <Select
                                            allowDeselect={false}
                                            data={[
                                                { label: 'Automatic HTTP-01', value: 'HTTP_01' },
                                                {
                                                    label: 'Import local files',
                                                    value: 'IMPORT_EXISTING'
                                                }
                                            ]}
                                            label="Certificate mode"
                                            onChange={(value) =>
                                                setHysteriaCertificateMode(value as CertificateMode)
                                            }
                                            value={hysteriaCertificateMode}
                                        />
                                    </Grid.Col>
                                    {hysteriaCertificateMode === 'HTTP_01' ? (
                                        <Grid.Col span={{ base: 12, sm: 3 }}>
                                            <TextInput
                                                label="ACME email"
                                                onChange={(e) =>
                                                    setHysteriaEmail(e.currentTarget.value)
                                                }
                                                value={hysteriaEmail}
                                            />
                                        </Grid.Col>
                                    ) : (
                                        <>
                                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                                <TextInput
                                                    label="Full chain path"
                                                    onChange={(e) =>
                                                        setHysteriaCertificatePath(
                                                            e.currentTarget.value
                                                        )
                                                    }
                                                    placeholder="/etc/letsencrypt/live/example/fullchain.pem"
                                                    value={hysteriaCertificatePath}
                                                />
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                                <TextInput
                                                    label="Private key path"
                                                    onChange={(e) =>
                                                        setHysteriaPrivateKeyPath(
                                                            e.currentTarget.value
                                                        )
                                                    }
                                                    placeholder="/etc/letsencrypt/live/example/privkey.pem"
                                                    value={hysteriaPrivateKeyPath}
                                                />
                                            </Grid.Col>
                                        </>
                                    )}
                                </Grid>
                            </ProtocolToggle>
                            <Switch
                                checked={enableWarp}
                                label="Install and enable shared WARP proxy"
                                onChange={(event) => setEnableWarp(event.currentTarget.checked)}
                            />
                            <MultiSelect
                                data={(squads?.internalSquads ?? []).map((squad) => ({
                                    label: squad.name,
                                    value: squad.uuid
                                }))}
                                label="Internal squads"
                                onChange={setSelectedSquads}
                                searchable
                                value={selectedSquads}
                            />
                            <Group justify="space-between">
                                <Button onClick={() => setActiveStep(1)} variant="subtle">
                                    Back
                                </Button>
                                <Button
                                    disabled={
                                        !wizardMachine || selectedCount === 0 || !provisionRequest
                                    }
                                    loading={isProvisioning}
                                    onClick={() =>
                                        wizardMachine &&
                                        provisionRequest &&
                                        provisionMachine({
                                            route: { uuid: wizardMachine.machine.uuid },
                                            variables: provisionRequest
                                        })
                                    }
                                >
                                    Provision {selectedCount} node(s)
                                </Button>
                            </Group>
                        </Stack>
                    </Stepper.Step>

                    <Stepper.Step description="Validate and expose" label="Publish">
                        <Stack mt="lg">
                            <Alert
                                color={
                                    readyNodes.length === targetNodeUuids.length ? 'teal' : 'blue'
                                }
                                icon={<TbCertificate />}
                            >
                                {readyNodes.length} of {targetNodeUuids.length} node(s) are
                                validated. Healthy sibling nodes can be published independently.
                            </Alert>
                            {machineNodes.map((node) => (
                                <Card key={node.uuid} padding="sm" withBorder>
                                    <Group justify="space-between">
                                        <Text fw={600}>{node.name}</Text>
                                        <Badge
                                            color={
                                                node.lifecycleState === 'CONFIG_VALIDATED' ||
                                                node.lifecycleState === 'PUBLISHED'
                                                    ? 'teal'
                                                    : node.lifecycleState === 'FAILED'
                                                      ? 'red'
                                                      : 'blue'
                                            }
                                        >
                                            {node.lifecycleState}
                                        </Badge>
                                    </Group>
                                    <Text c="dimmed" size="xs">
                                        Config {node.appliedRevision}/{node.desiredRevision} ·
                                        Certificate {node.certificateStatus}
                                    </Text>
                                    {node.lifecycleState === 'FAILED' && wizardMachine && (
                                        <Button
                                            loading={isRetrying}
                                            mt="xs"
                                            onClick={() =>
                                                retryMachine({
                                                    route: {
                                                        uuid: wizardMachine.machine.uuid
                                                    },
                                                    variables: { nodeUuids: [node.uuid] }
                                                })
                                            }
                                            size="xs"
                                            variant="light"
                                        >
                                            Retry failed step
                                        </Button>
                                    )}
                                </Card>
                            ))}
                            <Group justify="flex-end">
                                <Button
                                    disabled={
                                        readyNodes.length === 0 || selectedSquads.length === 0
                                    }
                                    loading={isPublishing}
                                    onClick={() =>
                                        wizardMachine &&
                                        publishMachine({
                                            route: { uuid: wizardMachine.machine.uuid },
                                            variables: {
                                                grants: readyNodes.map((node) => ({
                                                    nodeUuid: node.uuid,
                                                    internalSquadUuids: selectedSquads
                                                }))
                                            }
                                        })
                                    }
                                >
                                    Publish validated nodes
                                </Button>
                            </Group>
                        </Stack>
                    </Stepper.Step>
                </Stepper>
            </Modal>
        </Page>
    )
}

function ProtocolToggle(props: {
    checked: boolean
    children: ReactNode
    label: string
    onChange: (checked: boolean) => void
}) {
    return (
        <Card padding="md" withBorder>
            <Stack gap="sm">
                <Checkbox
                    checked={props.checked}
                    label={props.label}
                    onChange={(event) => props.onChange(event.currentTarget.checked)}
                />
                {props.checked && props.children}
            </Stack>
        </Card>
    )
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`
}

function statusColor(status: Machine['status']): string {
    if (status === 'PUBLISHED' || status === 'CONFIG_VALIDATED' || status === 'CONNECTED') {
        return 'teal'
    }
    if (status === 'FAILED' || status === 'DEGRADED') return 'red'
    return 'blue'
}
