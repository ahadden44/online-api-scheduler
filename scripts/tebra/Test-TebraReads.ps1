# Read-only check of the Tebra calls MedSlot uses to build a schedule.
# Usage: pwsh ./scripts/tebra/Test-TebraReads.ps1
#        pwsh ./scripts/tebra/Test-TebraReads.ps1 -Days 14

param(
  [int]$Days = 7
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/TebraSoap.ps1"

if ($Days -lt 1) { throw "-Days must be at least 1." }

$practice = Get-TebraPractice
Write-Output "Practice $($practice.Id)  $($practice.Name)"

Write-Output ""
Write-Output "Providers"
Get-TebraProviders | Format-Table -AutoSize | Out-String | Write-Output

Write-Output "Service locations"
Get-TebraLocations $practice.Id | Format-Table -AutoSize | Out-String | Write-Output

Write-Output "Appointment reasons"
Get-TebraReasons $practice.Id | Format-Table -AutoSize | Out-String | Write-Output

$from = [datetime]::SpecifyKind([datetime]::UtcNow.Date, [DateTimeKind]::Utc)
$to = $from.AddDays($Days)
Write-Output "Appointments $from to $to (UTC)"
$appointments = @(Get-TebraAppointments $from $to)
if ($appointments.Count -eq 0) {
  Write-Output "No patient appointments in that window."
} else {
  $appointments | Format-Table Id, Start, Status, Provider, Location, Reason, Patient -AutoSize | Out-String | Write-Output
}
