import { GetNodesCommand } from '@remnawave/backend-contract'

export interface IProps {
    isLoading: boolean
    nodes: GetNodesCommand.Response['response'] | undefined
}
