import { GetHostsCommand, GetConfigProfilesCommand } from '@remnawave/backend-contract'

export interface IProps {
    configProfiles: GetConfigProfilesCommand.Response['response']['configProfiles'] | undefined
    hosts: GetHostsCommand.Response['response'] | undefined
    moveSelected: (mode: 'bottom' | 'down' | 'top' | 'up') => void
    selectedHosts: string[]
    setSelectedHosts: (hosts: string[]) => void
}
