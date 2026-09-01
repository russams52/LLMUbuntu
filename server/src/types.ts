export type HazardType = "wire" | "pothole" | "road_issue" | "other";

export type AuthorityType =
  | "telecom_utility"
  | "town"
  | "county"
  | "state_outside_plant"
  | "placeholder";

export interface Authority {
  id: string;
  name: string;
  authority_type: AuthorityType;
  jurisdiction: string;
  state: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  min_lat: number | null;
  max_lat: number | null;
  min_lng: number | null;
  max_lng: number | null;
  is_placeholder: number;
}

export interface GeoContext {
  locality: string | null;
  county: string | null;
  state: string | null;
  stateCode: string | null;
  inLongIsland: boolean;
}

export interface RoutedAuthority {
  authority: Authority;
  role: string;
  reason: string;
}

export interface ReportRecord {
  id: string;
  hazard_type: HazardType;
  description: string | null;
  latitude: number;
  longitude: number;
  photo_path: string | null;
  locality: string | null;
  county: string | null;
  state: string | null;
  status: string;
  created_at: string;
}
