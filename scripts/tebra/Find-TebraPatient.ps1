# Look up a chart with GetPatients. Does not create a patient.
# Usage: pwsh ./scripts/tebra/Find-TebraPatient.ps1 -FirstName Elena -LastName Vasquez -DateOfBirth 1988-04-12

param(
  [Parameter(Mandatory = $true)][string]$FirstName,
  [Parameter(Mandatory = $true)][string]$LastName,
  [Parameter(Mandatory = $true)][string]$DateOfBirth
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/TebraSoap.ps1"

if ($DateOfBirth -notmatch '^\d{4}-\d{2}-\d{2}$') {
  throw "DateOfBirth must be YYYY-MM-DD."
}

$patients = @(Find-TebraPatients $FirstName $LastName $DateOfBirth)
if ($patients.Count -eq 0) {
  Write-Output "No chart matched that name and date of birth."
} else {
  $patients | Format-Table -AutoSize | Out-String | Write-Output
}
