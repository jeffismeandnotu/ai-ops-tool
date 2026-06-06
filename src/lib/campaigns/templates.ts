interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
}

const TEMPLATES: Template[] = [
  {
    id: "daily_reminder",
    name: "Appointment Reminder",
    subject: "Reminder: Your cleaning on {{date}}",
    body: `Hi {{first_name}},

This is a friendly reminder about your upcoming cleaning appointment on {{date}} at {{time}}.

  • Service: {{service}}
  • Address: {{address}}

If you need to make any changes, please reply to this email at least 24 hours before your appointment.

Warm regards,
Glow Cleaning Services`,
  },
  {
    id: "service_due",
    name: "Service Due / Re-booking Nudge",
    subject: "Time for your next clean, {{first_name}}",
    body: `Hi {{first_name}},

It has been a while since your last cleaning, and we wanted to check in. Regular cleaning keeps your space fresh and healthy — we would love to help.

If you would like to schedule your next session, simply reply to this email with your preferred date and time, and we will get it set up.

Looking forward to hearing from you.

Kind regards,
Glow Cleaning Services`,
  },
  {
    id: "followup",
    name: "Post-Service Follow-Up",
    subject: "How was your recent cleaning?",
    body: `Hi {{first_name}},

We hope your {{service}} on {{date}} went well. Your feedback helps us keep our standards high — if anything was not quite right, please let us know and we will make it right.

If everything looked good, we are glad to hear it. We look forward to your next appointment.

Best regards,
Glow Cleaning Services`,
  },
];

const registry = new Map<string, Template>(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(
  id: string
): { id: string; name: string; subject: string; body: string } | null {
  return registry.get(id) || null;
}

export function listTemplates(): { id: string; name: string; subject: string }[] {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, subject: t.subject }));
}

export function render(
  templateId: string,
  vars: Record<string, string>
): { subject: string; body: string } | null {
  const tpl = registry.get(templateId);
  if (!tpl) return null;

  const merge = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || "");

  return {
    subject: merge(tpl.subject),
    body: merge(tpl.body),
  };
}
