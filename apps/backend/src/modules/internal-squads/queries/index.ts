import { GetAffectedConfigProfilesBySquadUuidHandler } from './get-affected-config-profiles-by-squad-uuid/get-affected-config-profiles-by-squad-uuid.handler';
import { GetNodeUuidsBySquadUuidHandler } from './get-node-uuids-by-squad-uuid';

export const QUERIES = [
    GetAffectedConfigProfilesBySquadUuidHandler,
    GetNodeUuidsBySquadUuidHandler,
];
