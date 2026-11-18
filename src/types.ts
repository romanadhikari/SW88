export interface User {
  id: number;
  uid: string;
  username: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  isAgent?: boolean;
  createdAt: string;
  responsibleDailyLimit: number | null;
  selfExcludedUntil: string | null;
}

export interface MaintenanceState {
  enabled: boolean;
  message: string;
}

export interface Wallet {
  userId: number;
  mainBalance: number;
  availableBalance: number;
  reservedWithdrawal: number;
  withdrawableWinnings: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalStaked: number;
  totalWon: number;
  totalLost: number;
}

export interface GameInfo {
  id: '3-patti-royale' | 'bubble-rocket-x' | 'skyline-crash' | string;
  name: string;
  description: string;
  thumbnail: string;
  enabled: boolean;
  minStake: number;
  maxStake: number;
  houseEdgePct: number;
  settings: Record<string, any>;
}

export interface NotificationItem {
  id: string;
  user_id: number;
  type: string;
  title: string;
  message: string;
  related_id: string | null;
  is_read: number;
  created_at: string;
}

export interface BannedPayload {
  title: string;
  message: string;
}

export interface QrInfo {
  active: boolean;
  instructions: string;
  imageUrl: string | null;
  unavailableMessage: string | null;
  updatedAt: string | null;
}

export interface DepositRecord {
  id: string;
  user_id?: number;
  user_uid?: string;
  username?: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_message: string | null;
  screenshot_deleted?: number;
  screenshotAvailable?: boolean;
  reviewed_by_uid?: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface WithdrawalRecord {
  id: string;
  user_id: number;
  user_uid: string;
  username: string;
  amount: number;
  method: 'ESEWA' | 'BANK';
  account_holder_name: string;
  esewa_mobile: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_branch: string | null;
  request_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  payment_status: 'NOT PAID' | 'PROCESSING' | 'PAID' | 'PAYMENT FAILED';
  admin_note: string | null;
  rejection_reason: string | null;
  reviewed_by_uid: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
}
