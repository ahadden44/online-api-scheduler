# Create one Tentative appointment, the same CreateAppointment body MedSlot sends.
# Nothing is written unless -Create is present.
# Start and End are UTC, for example 2026-09-30T14:00:00Z.
#
# pwsh ./scripts/tebra/New-TebraTentativeAppointment.ps1 -Create `
#   -PatientId 1 -ProviderId 2 -ServiceLocationId 3 -ReasonId 4 `
#   -Start 2026-09-30T14:00:00Z -End 2026-09-30T14:20:00Z

param(
  [switch]$Create,
  [string]$PatientId,
  [string]$ProviderId,
  [string]$ServiceLocationId,
  [string]$ReasonId,
  [string]$Start,
  [string]$End,
  [ValidateSet("InOffice", "Telehealth")][string]$Mode = "InOffice",
  [string]$Name = "MedSlot test"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/TebraSoap.ps1"

if (-not $Create) {
  Write-Output "Add -Create to hold a tentative visit. This script does not write anything until then."
  Write-Output "Copy PatientId, ProviderId, ServiceLocationId, and ReasonId from Test-TebraReads.ps1 and Find-TebraPatient.ps1."
  exit 0
}

foreach ($pair in @(
    @{ Name = "PatientId"; Value = $PatientId },
    @{ Name = "ProviderId"; Value = $ProviderId },
    @{ Name = "ServiceLocationId"; Value = $ServiceLocationId },
    @{ Name = "ReasonId"; Value = $ReasonId },
    @{ Name = "Start"; Value = $Start },
    @{ Name = "End"; Value = $End }
  )) {
  if ([string]::IsNullOrWhiteSpace($pair.Value)) { throw "$($pair.Name) is required with -Create." }
}

$startTime = [datetimeoffset]::Parse($Start, [cultureinfo]::InvariantCulture).UtcDateTime
$endTime = [datetimeoffset]::Parse($End, [cultureinfo]::InvariantCulture).UtcDateTime
if ($endTime -le $startTime) { throw "End must be after Start." }

$practice = Get-TebraPractice
$id = New-TebraTentativeVisit -PracticeId $practice.Id -PatientId $PatientId -ProviderId $ProviderId -ServiceLocationId $ServiceLocationId -ReasonId $ReasonId -Start $startTime -End $endTime -Mode $Mode -Name $Name
Write-Output "Tentative appointment $id"
Write-Output "Cancel it with: pwsh ./scripts/tebra/Set-TebraAppointmentStatus.ps1 -AppointmentId $id -Status Cancelled"
