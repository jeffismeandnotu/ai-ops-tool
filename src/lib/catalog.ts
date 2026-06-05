import { BUSINESS } from "@/config/business";

// ============================================================
// SERVICE CATALOG — price authority
// ============================================================
// The model NEVER types a price. It passes a service_id; this
// module returns the canonical name/price/duration/description
// from config. Unknown ids are rejected, not guessed.
// ============================================================

export interface ServiceInfo {
  id: string;
  name: string;
  price: number;
  duration: number; // minutes
  description: string;
}

export function listServices(): ServiceInfo[] {
  return BUSINESS.services.map((s) => ({
    id: s.id,
    name: s.name,
    price: s.price,
    duration: s.duration,
    description: s.description,
  }));
}

export function getService(serviceId: string): ServiceInfo | null {
  const s = BUSINESS.services.find((x) => x.id === serviceId);
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    price: s.price,
    duration: s.duration,
    description: s.description,
  };
}

// Strict lookup used by guarded tools: throws on unknown id so a
// bad service_id can never silently become a wrong price.
export function requireService(serviceId: string): ServiceInfo {
  const s = getService(serviceId);
  if (!s) {
    const valid = BUSINESS.services.map((x) => x.id).join(", ");
    throw new Error(`Unknown service_id '${serviceId}'. Valid ids: ${valid}`);
  }
  return s;
}
