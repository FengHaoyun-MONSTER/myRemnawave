import { GetNodesCommand } from '@remnawave/backend-contract'

export interface IProps {
    nodes: GetNodesCommand.Response['response'] | undefined
}
