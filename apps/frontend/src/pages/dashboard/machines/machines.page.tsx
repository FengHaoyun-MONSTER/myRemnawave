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
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { TbCertificate, TbCloudLock, TbPlus, TbServer, TbShieldCheck } from 'react-icons/tb'
import { z } from 'zod'

import { getBackendDomain, queryClient } from '@shared/api'
import {
    machinesQueryKeys,
    nodesQueryKeys,
    useApplyMachineProvisioningPlan,
    useAuthorizeMachineWarpTakeover,
    useCreateMachine,
    useGetInternalSquads,
    useGetMachineControlStatus,
    useGetMachineProvisioningPlan,
    useGetMachines,
    useGetNodes,
    useProvisionMachine,
    usePublishMachine,
    useRetryMachine,
    useRotateMachineEnrollmentToken
} from '@shared/api/hooks'
import { LoadingScreen, Page, PageHeaderShared } from '@shared/ui'

type Machine = z.infer<typeof MachineSchema>
type WizardMachine = {
    machine: Machine
    enrollmentToken?: string
    enrollmentExpiresAt?: Date
}
type ProtocolSelection = Record<'HYSTERIA2' | 'VLESS_REALITY' | 'VLESS_TLS_VISION', boolean>
type CertificateMode = 'HTTP_01' | 'IMPORT_EXISTING'

const AGENT_VERSION = 'v0.2.0'
const EMPTY_UUID = '00000000-0000-4000-8000-000000000000'

const initialProtocols: ProtocolSelection = {
    VLESS_REALITY: true,
    VLESS_TLS_VISION: true,
    HYSTERIA2: true
}

export function MachinesPage() {
    const { data: machines, isLoading } = useGetMachines()
    const { data: controlStatus } = useGetMachineControlStatus()
    const { data: nodes } = useGetNodes()
    const { data: squads } = useGetInternalSquads()
    const [opened, setOpened] = useState(false)
    const [activeStep, setActiveStep] = useState(0)
    const [wizardMachine, setWizardMachine] = useState<WizardMachine | null>(null)
    const [provisionedNodeUuids, setProvisionedNodeUuids] = useState<string[]>([])
    const [provisioningPlanUuid, setProvisioningPlanUuid] = useState<string | null>(null)
    const applyingPlanRef = useRef<string | null>(null)
    const [clock, setClock] = useState(() => Date.now())

    useEffect(() => {
        if (!wizardMachine) return
        const timer = window.setInterval(() => setClock(Date.now()), 1_000)
        return () => window.clearInterval(timer)
    }, [wizardMachine?.machine.uuid])

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
    const [fallbackPortPool, setFallbackPortPool] = useState('')
    const [enableWarp, setEnableWarp] = useState(true)
    const [selectedSquads, setSelectedSquads] = useState<string[]>([])

    const { data: provisioningPlan } = useGetMachineProvisioningPlan({
        route: {
            uuid: wizardMachine?.machine.uuid ?? EMPTY_UUID,
            planUuid: provisioningPlanUuid ?? EMPTY_UUID
        },
        rQueryParams: {
            enabled: Boolean(provisioningPlanUuid && wizardMachine && activeStep === 2)
        }
    })

    const currentMachine = machines?.find((machine) => machine.uuid === wizardMachine?.machine.uuid)
    const warpTakeoverRequired =
        provisioningPlan?.status === 'BLOCKED' &&
        provisioningPlan.result?.dependencies.some(
            (dependency) =>
                dependency.name === 'warp' &&
                dependency.state === 'TAKEOVER_REQUIRED' &&
                dependency.ownership === 'EXTERNAL'
        )
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
        setProvisioningPlanUuid(null)
        applyingPlanRef.current = null
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
        queryClient.invalidateQueries({
            queryKey: machinesQueryKeys.getMachines.queryKey
        })
        queryClient.invalidateQueries({
            queryKey: nodesQueryKeys.getAllNodes.queryKey
        })
    }

    const { mutate: createMachine, isPending: isCreating } = useCreateMachine({
        mutationFns: {
            onSuccess: (result) => {
                setWizardMachine({
                    machine: result.machine,
                    enrollmentToken: result.enrollmentToken,
                    enrollmentExpiresAt: result.enrollmentExpiresAt
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
                    enrollmentToken: result.enrollmentToken,
                    enrollmentExpiresAt: result.enrollmentExpiresAt
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
                applyingPlanRef.current = null
                setProvisioningPlanUuid(result.plan.uuid)
                refresh()
            }
        }
    })
    const { mutate: applyProvisioningPlan, isPending: isApplyingPlan } =
        useApplyMachineProvisioningPlan({
            mutationFns: {
                onSuccess: (result) => {
                    setProvisionedNodeUuids(result.nodeUuids)
                    setActiveStep(3)
                    refresh()
                },
                onError: () => {
                    applyingPlanRef.current = null
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
    const { mutate: authorizeWarpTakeover, isPending: isAuthorizingWarpTakeover } =
        useAuthorizeMachineWarpTakeover({
            mutationFns: {
                onSuccess: () => {
                    if (!wizardMachine || !provisioningPlanUuid) return
                    queryClient.invalidateQueries({
                        queryKey: machinesQueryKeys.getProvisioningPlan({
                            uuid: wizardMachine.machine.uuid,
                            planUuid: provisioningPlanUuid
                        }).queryKey
                    })
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

    useEffect(() => {
        if (
            !wizardMachine ||
            !provisioningPlan ||
            provisioningPlan.status !== 'READY' ||
            applyingPlanRef.current === provisioningPlan.uuid
        ) {
            return
        }
        applyingPlanRef.current = provisioningPlan.uuid
        applyProvisioningPlan({
            route: {
                uuid: wizardMachine.machine.uuid,
                planUuid: provisioningPlan.uuid
            },
            variables: {}
        })
    }, [applyProvisioningPlan, provisioningPlan, wizardMachine])

    const enrollmentCommand = useMemo(() => {
        if (!wizardMachine?.enrollmentToken) return ''
        const backend = String(getBackendDomain()).replace(/\/$/, '')
        const endpoint = `${backend}/api/machine-enrollment`
        const installer = `https://raw.githubusercontent.com/FengHaoyun-MONSTER/myRemnawave/${AGENT_VERSION}/apps/machine-agent/install.sh`
        return `curl -fsSL ${shellQuote(installer)} | sh -s -- --version ${shellQuote(AGENT_VERSION)} --panel-url ${shellQuote(endpoint)} --token ${shellQuote(wizardMachine.enrollmentToken)}`
    }, [wizardMachine])

    const buildProvisionRequest = (): ProvisionMachineCommand.RequestBody | null => {
        const fallbackPorts = parseFallbackPorts(fallbackPortPool)
        if (fallbackPorts === null) return null
        const requested: ProvisionMachineCommand.RequestBody['protocols'] = []
        if (protocols.VLESS_REALITY) {
            requested.push({
                protocol: 'VLESS_REALITY',
                externalPort: realityPort,
                ...(fallbackPorts ? { fallbackPorts } : {}),
                serverName: realityServerName,
                target: realityTarget
            })
        }
        if (protocols.VLESS_TLS_VISION) {
            requested.push({
                protocol: 'VLESS_TLS_VISION',
                externalPort: tlsPort,
                ...(fallbackPorts ? { fallbackPorts } : {}),
                certificate:
                    tlsCertificateMode === 'HTTP_01'
                        ? {
                              mode: 'HTTP_01',
                              domain: tlsDomain,
                              email: tlsEmail
                          }
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
                ...(fallbackPorts ? { fallbackPorts } : {}),
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
        setProvisioningPlanUuid(null)
        applyingPlanRef.current = null
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

    const configureMissingProtocols = () => {
        const existing = new Set(machineNodes.map((node) => node.protocolKey))
        setProtocols({
            VLESS_REALITY: !existing.has('VLESS_REALITY'),
            VLESS_TLS_VISION: !existing.has('VLESS_TLS_VISION'),
            HYSTERIA2: !existing.has('HYSTERIA2')
        })
        setProvisioningPlanUuid(null)
        applyingPlanRef.current = null
        setActiveStep(2)
    }

    if (isLoading) return <LoadingScreen />

    const provisionRequest = buildProvisionRequest()
    const agentConnected = Boolean(
        currentMachine?.agentCapabilities.length &&
        currentMachine.agentLastSeenAt &&
        clock - currentMachine.agentLastSeenAt.getTime() <= 2 * 60_000
    )
    const selectedCount = Object.values(protocols).filter(Boolean).length
    const enrollmentRemaining = wizardMachine?.enrollmentExpiresAt
        ? Math.max(0, wizardMachine.enrollmentExpiresAt.getTime() - clock)
        : null
    const controlReady = controlStatus?.ready === true

    return (
        <Page title="Machines">
            <PageHeaderShared
                actions={
                    <Button
                        disabled={!controlReady}
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

            {!controlReady && (
                <Alert color="red" mb="md" title="Machine control plane unavailable">
                    Machine enrollment is disabled until the mTLS control listener is configured and
                    ready. Check the panel deployment and its configured machine-control TCP port
                    before creating a machine.
                </Alert>
            )}

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
                                        {machine.warpStatus} · {machine.warpOwnership}
                                    </Text>
                                    {machine.lastStatusMessage && (
                                        <Text c="red" size="xs">
                                            {machine.lastErrorCode ?? 'MACHINE_COMMAND_FAILED'}:{' '}
                                            {machine.lastStatusMessage}
                                        </Text>
                                    )}
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
                            <Group justify="space-between">
                                {wizardMachine && machineNodes.length < 3 && (
                                    <Button onClick={configureMissingProtocols} variant="subtle">
                                        Add missing protocol
                                    </Button>
                                )}
                                {!wizardMachine && (
                                    <Button
                                        disabled={
                                            name.trim().length < 3 || address.trim().length < 2
                                        }
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
                                )}
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
                                    : 'Run this one-time command as root. It installs only the pinned Agent and enrolls without uploading SSH credentials or private keys. Docker and WARP are handled later from an approved resource plan.'}
                            </Alert>
                            {enrollmentCommand ? (
                                <>
                                    {enrollmentRemaining !== null && (
                                        <Alert color={enrollmentRemaining > 0 ? 'yellow' : 'red'}>
                                            {enrollmentRemaining > 0
                                                ? `This one-time token expires in ${formatRemaining(enrollmentRemaining)}.`
                                                : 'This one-time token has expired. Issue a new token before enrolling.'}
                                        </Alert>
                                    )}
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
                                    {!agentConnected && enrollmentRemaining === 0 && (
                                        <Button
                                            loading={isRotating}
                                            onClick={() =>
                                                wizardMachine &&
                                                rotateToken({
                                                    route: {
                                                        uuid: wizardMachine.machine.uuid
                                                    }
                                                })
                                            }
                                        >
                                            Issue a new one-time token
                                        </Button>
                                    )}
                                </>
                            ) : (
                                !agentConnected && (
                                    <Button
                                        loading={isRotating}
                                        onClick={() =>
                                            wizardMachine &&
                                            rotateToken({
                                                route: {
                                                    uuid: wizardMachine.machine.uuid
                                                }
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
                            <TextInput
                                description="Optional comma-separated override for this Machine. Leave empty to use the panel-wide deterministic fallback order."
                                error={
                                    parseFallbackPorts(fallbackPortPool) === null
                                        ? 'Use 1-15 unique ports from 1-65535; 2222-2224 are reserved.'
                                        : undefined
                                }
                                label="Fallback port pool"
                                onChange={(event) => setFallbackPortPool(event.currentTarget.value)}
                                placeholder="2053,2083,2087,2096,2443,9443"
                                value={fallbackPortPool}
                            />
                            <ProtocolToggle
                                checked={protocols.VLESS_REALITY}
                                label="VLESS + Reality + Vision"
                                onChange={(checked) =>
                                    setProtocols((value) => ({
                                        ...value,
                                        VLESS_REALITY: checked
                                    }))
                                }
                            >
                                <Grid>
                                    <Grid.Col span={{ base: 12, sm: 4 }}>
                                        <NumberInput
                                            label="Preferred TCP port"
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
                                            label="Preferred TCP port"
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
                                                {
                                                    label: 'Automatic HTTP-01',
                                                    value: 'HTTP_01'
                                                },
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
                                    setProtocols((value) => ({
                                        ...value,
                                        HYSTERIA2: checked
                                    }))
                                }
                            >
                                <Grid>
                                    <Grid.Col span={{ base: 12, sm: 3 }}>
                                        <NumberInput
                                            label="Preferred UDP port"
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
                                                {
                                                    label: 'Automatic HTTP-01',
                                                    value: 'HTTP_01'
                                                },
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
                                label="Use host WARP (install managed WARP or safely reuse a compatible external proxy)"
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
                            {provisioningPlan && (
                                <Alert
                                    color={
                                        provisioningPlan.status === 'READY' ||
                                        provisioningPlan.status === 'APPLIED'
                                            ? 'teal'
                                            : provisioningPlan.status === 'PENDING'
                                              ? 'blue'
                                              : 'red'
                                    }
                                    title={`Resource plan: ${provisioningPlan.status}`}
                                >
                                    <Stack gap="xs">
                                        {provisioningPlan.result?.machineChecks.map((check) => (
                                            <Group
                                                align="flex-start"
                                                justify="space-between"
                                                key={check.code}
                                                wrap="nowrap"
                                            >
                                                <div>
                                                    <Text size="sm">{check.code}</Text>
                                                    <Text c="dimmed" size="xs">
                                                        {check.message}
                                                    </Text>
                                                </div>
                                                <Badge
                                                    color={
                                                        check.ok
                                                            ? 'teal'
                                                            : check.advisory
                                                              ? 'yellow'
                                                              : 'red'
                                                    }
                                                >
                                                    {check.ok
                                                        ? 'PASS'
                                                        : check.advisory
                                                          ? 'REVIEW'
                                                          : 'BLOCKED'}
                                                </Badge>
                                            </Group>
                                        ))}
                                        {provisioningPlan.result?.dependencies
                                            .filter((dependency) => dependency.required)
                                            .map((dependency) => (
                                                <Group
                                                    justify="space-between"
                                                    key={dependency.name}
                                                >
                                                    <Text size="sm">
                                                        {dependency.name.toUpperCase()} ·{' '}
                                                        {dependency.ownership}
                                                    </Text>
                                                    <Badge
                                                        color={
                                                            dependency.action === 'NONE' &&
                                                            dependency.state !== 'READY_EXTERNAL' &&
                                                            dependency.state !== 'READY_MANAGED'
                                                                ? 'red'
                                                                : dependency.action ===
                                                                    'TAKEOVER_REQUIRED'
                                                                  ? 'red'
                                                                  : 'blue'
                                                        }
                                                    >
                                                        {dependency.state} / {dependency.action}
                                                    </Badge>
                                                </Group>
                                            ))}
                                        {provisioningPlan.result?.protocols.map((protocol) => (
                                            <Stack gap={2} key={protocol.protocol}>
                                                <Group justify="space-between">
                                                    <Text size="sm">{protocol.protocol}</Text>
                                                    <Badge
                                                        color={
                                                            protocol.status === 'READY'
                                                                ? 'teal'
                                                                : 'red'
                                                        }
                                                    >
                                                        {protocol.status === 'READY'
                                                            ? `${protocol.network.toUpperCase()} ${protocol.selectedPort}`
                                                            : protocol.errorCode}
                                                    </Badge>
                                                </Group>
                                                <Text c="dimmed" size="xs">
                                                    Candidates:{' '}
                                                    {protocol.portAttempts.length > 0
                                                        ? protocol.portAttempts
                                                              .map(
                                                                  (attempt) =>
                                                                      `${attempt.port} ${attempt.available ? 'free' : 'unavailable'}`
                                                              )
                                                              .join(', ')
                                                        : 'not evaluated'}
                                                </Text>
                                                {protocol.message && (
                                                    <Text c="red" size="xs">
                                                        {protocol.message}
                                                    </Text>
                                                )}
                                            </Stack>
                                        ))}
                                        {(provisioningPlan.errorMessage ||
                                            provisioningPlan.errorCode) && (
                                            <Text c="red" size="xs">
                                                {provisioningPlan.errorCode ?? 'PLAN_FAILED'}:{' '}
                                                {provisioningPlan.errorMessage ??
                                                    'Resource planning failed'}
                                            </Text>
                                        )}
                                        {warpTakeoverRequired && wizardMachine && (
                                            <Button
                                                color="red"
                                                loading={isAuthorizingWarpTakeover}
                                                onClick={() => {
                                                    const confirmed = window.confirm(
                                                        'This adopts the existing host WARP for myRemnawave management. Continue only if it is not used by 3X-UI. The Agent will refuse when it detects any 3X-UI indicator, and a new resource plan will be required.'
                                                    )
                                                    if (!confirmed) return
                                                    authorizeWarpTakeover({
                                                        route: {
                                                            uuid: wizardMachine.machine.uuid,
                                                            planUuid: provisioningPlan.uuid
                                                        },
                                                        variables: {
                                                            confirmation: 'TAKE_OVER_EXTERNAL_WARP',
                                                            attestNo3xuiUse: true
                                                        }
                                                    })
                                                }}
                                                size="xs"
                                                variant="light"
                                            >
                                                Authorize external WARP takeover
                                            </Button>
                                        )}
                                    </Stack>
                                </Alert>
                            )}
                            <Group justify="space-between">
                                <Button onClick={() => setActiveStep(1)} variant="subtle">
                                    Back
                                </Button>
                                <Button
                                    disabled={
                                        !wizardMachine || selectedCount === 0 || !provisionRequest
                                    }
                                    loading={
                                        isProvisioning ||
                                        isApplyingPlan ||
                                        provisioningPlan?.status === 'PENDING'
                                    }
                                    onClick={() => {
                                        if (!wizardMachine || !provisionRequest) return
                                        applyingPlanRef.current = null
                                        setProvisioningPlanUuid(null)
                                        provisionMachine({
                                            route: {
                                                uuid: wizardMachine.machine.uuid
                                            },
                                            variables: provisionRequest
                                        })
                                    }}
                                >
                                    Plan and provision {selectedCount} node(s)
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
                                        Certificate {node.certificateStatus} ·{' '}
                                        {node.externalNetwork?.toUpperCase() ?? 'PORT'}{' '}
                                        {node.externalPort ?? 'pending'}
                                    </Text>
                                    {node.lastStatusMessage && (
                                        <Text c="red" size="xs">
                                            {node.lastErrorCode ?? 'NODE_COMMAND_FAILED'}:{' '}
                                            {node.lastStatusMessage}
                                        </Text>
                                    )}
                                    {['FAILED', 'DEGRADED'].includes(node.lifecycleState) &&
                                        wizardMachine && (
                                            <Button
                                                loading={isRetrying}
                                                mt="xs"
                                                onClick={() =>
                                                    retryMachine({
                                                        route: {
                                                            uuid: wizardMachine.machine.uuid
                                                        },
                                                        variables: {
                                                            nodeUuids: [node.uuid]
                                                        }
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
                            <Group justify="space-between">
                                {wizardMachine && machineNodes.length < 3 && (
                                    <Button onClick={configureMissingProtocols} variant="subtle">
                                        Add missing protocol
                                    </Button>
                                )}
                                <Button
                                    disabled={
                                        readyNodes.length === 0 || selectedSquads.length === 0
                                    }
                                    loading={isPublishing}
                                    onClick={() =>
                                        wizardMachine &&
                                        publishMachine({
                                            route: {
                                                uuid: wizardMachine.machine.uuid
                                            },
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

function formatRemaining(milliseconds: number): string {
    const totalSeconds = Math.ceil(milliseconds / 1_000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function parseFallbackPorts(value: string): number[] | undefined | null {
    if (value.trim() === '') return undefined
    const ports = value.split(',').map((port) => Number(port.trim()))
    if (
        ports.length > 15 ||
        ports.some(
            (port) =>
                !Number.isInteger(port) ||
                port < 1 ||
                port > 65_535 ||
                [2222, 2223, 2224].includes(port)
        ) ||
        new Set(ports).size !== ports.length
    ) {
        return null
    }
    return ports
}

function statusColor(status: Machine['status']): string {
    if (status === 'PUBLISHED' || status === 'CONFIG_VALIDATED' || status === 'CONNECTED') {
        return 'teal'
    }
    if (status === 'FAILED' || status === 'DEGRADED') return 'red'
    return 'blue'
}
