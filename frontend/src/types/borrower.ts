export interface ApprovedBorrower {
  borrower_id: string;
  name: string;
  jurisdiction: string;
  status: string;
  approved_at: string;
}

export interface ApprovedBorrowerListResponse {
  borrowers: ApprovedBorrower[];
}

export interface BorrowerCreateRequest {
  name: string;
  jurisdiction: string;
  contact_email: string;
  connection_id?: string;
}

export interface BorrowerCreateResponse {
  borrower_id: string;
  status: 'active';
  approved_connection_id: string | null;
}

export interface BorrowerDetail {
  id: string;
  invited_by: string;
  name: string;
  jurisdiction: string;
  contact_email: string;
  status: string;
  created_at: string;
}

export interface BorrowerListResponse {
  borrowers: BorrowerDetail[];
}
