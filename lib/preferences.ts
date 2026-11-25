import type { PreferenceDTO } from "@/lib/api-types";
import type { Preference } from "@/lib/db/schema";
import { describeRule } from "@/lib/scheduling/rules";

export function toPreferenceDTO(p: Preference): PreferenceDTO {
  return {
    id: p.id,
    ruleText: p.ruleText,
    rule: p.rule,
    description: describeRule(p.rule, p.ruleText),
    active: p.active,
    createdAt: p.createdAt.toISOString(),
  };
}
