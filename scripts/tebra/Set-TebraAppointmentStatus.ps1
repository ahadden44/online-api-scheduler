# Change a visit status with UpdateAppointmentStatus, the same call MedSlot uses to cancel.
# Usage: pwsh ./scripts/tebra/Set-TebraAppointmentStatus.ps1 -AppointmentId 99 -Status Cancelled

param(
  [Parameter(Mandatory = $true)][string]$AppointmentId,
  [ValidateSet("Tentative", "Scheduled", "Confirmed", "Cancelled", "Rescheduled", "NoShow")]
  [string]$Status = "Cancelled"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/TebraSoap.ps1"

Set-TebraVisitStatus $AppointmentId $Status
Write-Output "Appointment $AppointmentId is now $Status"
