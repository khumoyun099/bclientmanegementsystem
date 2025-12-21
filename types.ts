
export enum Role {
  AGENT = 'agent',
  ADMIN = 'admin',
}

export enum LeadStatus {
  HOT = 'hot',
  WARM = 'warm',
  COLD = 'cold',
  PROGRESSIVE = 'progressive',
  SOLD = 'sold',
  CLOSED = 'closed',
}

export enum TodoStatus {
  NEW = 'new',
  FOLLOWUP = 'followup',
  CALLBACK = 'callback',
  SALE = 'sale',
}

export enum EveryFreq {
  FIVE_DAYS = '5',
  SIX_DAYS = '6',
  SEVEN_DAYS = '7',
  EIGHT_DAYS = '8',
  TEN_DAYS = '10',
  TWELVE_DAYS = '12',
}

export enum DeletionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied',
}

export enum StrategyItemType {
  H1 = 'h1',
  H2 = 'h2',
  BULLET = 'bullet',
  NUMBER = 'number',
  TODO = 'todo',
  QUOTE = 'quote',
  DIVIDER = 'divider',
  STICKER = 'sticker',
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  points?: number;
  theme_preference?: 'system' | 'dark' | 'light';
}

export interface PersonalTask {
  id: string;
  user_id: string;
  text: string;
  completed: boolean;
  created_at: string;
}

export interface Note {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author_name: string;
}

export interface Lead {
  id: string;
  name: string;
  link?: string;
  notes: Note[];
  status: LeadStatus;
  todo: TodoStatus;
  every?: EveryFreq | null;
  follow_up_date: string; // YYYY-MM-DD
  assigned_agent_id: string;
  assigned_agent_name?: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
  deletionRequest?: {
    status: DeletionStatus;
    requestedBy: string;
    requestedAt: string;
  };
  deal_value?: number;
  customer_type?: 'new' | 'return' | null;
  tp_sold?: boolean;
  tp_value?: number;
  lead_source?: 'created' | 'taken';
  close_reason?: string;
  cold_status?: 'Unreached' | 'Unresponsive';
  cold_days?: boolean[];
  cold_start_date?: string; 
  cold_check_history?: string[]; 
}

export interface ActivityLog {
  id: string;
  lead_id: string;
  agent_id: string;
  action: 'note_added' | 'date_changed' | 'status_changed' | 'created' | 'rule_violation';
  details: string;
  created_at: string;
}

export interface PointsHistory {
  id: string;
  agent_id: string;
  agent_name: string | null;
  amount: number;
  reason: string;
  lead_id: string | null;
  created_at: string;
}

export interface StrategyItem {
  id: string;
  agent_id: string;
  type: StrategyItemType;
  content: string;
  checked?: boolean;
  color?: string;
  order: number;
  created_at?: string;
}

export interface PayoutRequest {
  id: string;
  agent_id: string;
  agent_name: string;
  points_requested: number;
  dollar_value: number;
  status: 'pending' | 'approved' | 'denied';
  admin_note?: string;
  requested_at: string;
  processed_at?: string;
  processed_by?: string;
}

export interface AgentTarget {
  id: string;
  agent_id: string;
  agent_name: string;
  month: string; // YYYY-MM-DD
  gp_target: number;
  sales_target: number;
  tp_target: number;
  tp_number_target: number;
  manual_new_gp?: number;
  manual_return_gp?: number;
  manual_sales_num?: number;
  manual_tp_gp?: number;
  manual_tp_num?: number;
  manual_created_leads?: number;
  manual_taken_leads?: number;
  manual_total_leads?: number;
  manual_week1?: number;
  manual_week2?: number;
  manual_week3?: number;
  manual_week4?: number;
}

export interface AgentStats {
  agent_id: string;
  agent_name: string;
  new_gp: number;
  return_gp: number;
  total_gp: number;
  sales_num: number;
  tp_gp: number;
  tp_number: number;
  created_leads: number;
  taken_leads: number;
  total_leads: number;
  gp_per_lead: number;
  gp_target: number;
  sales_target: number;
  tp_target: number;
  tp_number_target: number;
  gp_progress: number;
  sales_progress: number;
  tp_progress: number;
  tp_number_progress: number;
  week1: number;
  week2: number;
  week3: number;
  week4: number;
}
