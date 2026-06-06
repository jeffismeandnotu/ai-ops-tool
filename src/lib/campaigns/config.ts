// ============================================================
// CAMPAIGN DEFINITIONS — plain config, easy to edit
// ============================================================

export interface CampaignConfig {
  id: string;
  templateId: string;
  schedule: string; // informational, not wired to cron yet
  audience: "recipients_table";
}

export const CAMPAIGNS: CampaignConfig[] = [
  {
    id: "daily_reminder",
    templateId: "daily_reminder",
    schedule: "daily at 8am Pacific",
    audience: "recipients_table",
  },
  {
    id: "service_due",
    templateId: "service_due",
    schedule: "weekly on Monday at 9am Pacific",
    audience: "recipients_table",
  },
  {
    id: "followup",
    templateId: "followup",
    schedule: "daily at 10am Pacific (post-service)",
    audience: "recipients_table",
  },
];

export function getCampaign(id: string): CampaignConfig | undefined {
  return CAMPAIGNS.find((c) => c.id === id);
}

export function listCampaigns(): CampaignConfig[] {
  return CAMPAIGNS;
}
