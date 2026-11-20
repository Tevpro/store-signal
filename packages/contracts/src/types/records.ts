import type { StoreIdentity } from "./store-identity.ts";
import type { Evidence } from "./evidence.ts";
import type { Coverage } from "./coverage.ts";
import type { Assessment } from "./assessment.ts";

export interface V1Records { identity: StoreIdentity; evidence: Evidence; coverage: Coverage; assessment: Assessment }
