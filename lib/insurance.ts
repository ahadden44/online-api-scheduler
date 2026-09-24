import { isDateKey } from "@/lib/time";

export const INSURANCE_PLANS = [
  "Aetna",
  "Blue Cross Blue Shield MN",
  "Blue Plus",
  "Health Partners",
  "Medica",
  "Medicare",
  "Spectera",
  "UCare",
  "UMR",
  "United Health Care",
  "VSP",
  "None/Cash Payment",
] as const;

export const CASH_PLAN = "None/Cash Payment";

export type InsuranceInput = {
  plan?: string;
  groupId?: string;
  memberId?: string;
  primaryHolder?: string;
  primaryHolderDob?: string;
};

export type InsuranceDetails = {
  plan: (typeof INSURANCE_PLANS)[number];
  groupId: string;
  memberId: string;
  primaryHolder: string;
  primaryHolderDob: string;
};

export function readInsurance(input: InsuranceInput): InsuranceDetails {
  const plan = input.plan?.trim() ?? "";
  if (!INSURANCE_PLANS.includes(plan as InsuranceDetails["plan"])) {
    throw new Error("Choose a type of insurance.");
  }
  if (plan === CASH_PLAN) {
    return { plan, groupId: "", memberId: "", primaryHolder: "", primaryHolderDob: "" };
  }
  const groupId = input.groupId?.trim() ?? "";
  const memberId = input.memberId?.trim() ?? "";
  const primaryHolder = input.primaryHolder?.trim() ?? "";
  const primaryHolderDob = input.primaryHolderDob?.trim() ?? "";
  if (!groupId) throw new Error("Group ID is required for this insurance.");
  if (!memberId) throw new Error("Member ID is required for this insurance.");
  if (primaryHolder && !primaryHolderDob) throw new Error("Enter the primary holder’s date of birth, or leave both holder fields blank if the patient is the holder.");
  if (!primaryHolder && primaryHolderDob) throw new Error("Enter the primary holder’s name, or leave both holder fields blank if the patient is the holder.");
  if (primaryHolderDob && !isDateKey(primaryHolderDob)) throw new Error("Enter the primary holder’s date of birth as YYYY-MM-DD.");
  return { plan: plan as InsuranceDetails["plan"], groupId, memberId, primaryHolder, primaryHolderDob };
}

export function insuranceNote(details: InsuranceDetails): string {
  if (details.plan === CASH_PLAN) return "Insurance: None/Cash Payment.";
  const holder = details.primaryHolder
    ? `Primary holder: ${details.primaryHolder}, DOB ${details.primaryHolderDob}.`
    : "Primary holder: self.";
  return `Insurance: ${details.plan}. Group ID: ${details.groupId}. Member ID: ${details.memberId}. ${holder}`;
}
