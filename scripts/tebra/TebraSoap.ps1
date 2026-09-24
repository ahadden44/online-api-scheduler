# Shared SOAP client for the MedSlot Tebra calls.
# Dot-source this file. Do not run it directly.

$script:TebraNamespace = "http://www.kareo.com/api/schemas/"
$script:TebraLocationNamespace = "http://www.kareo.com/api/schemas"
$script:TebraEndpoint = "https://webservice.kareo.com/services/soap/2.1/KareoServices.svc"
$script:TebraLastCall = @{}
$script:TebraGapMs = @{
  GetAppointments     = 1100
  GetPatients         = 1100
  GetAppointment      = 600
  GetProviders        = 600
  GetPractices        = 600
  GetServiceLocations = 600
  CreateAppointment   = 600
  CreatePatient       = 600
  UpdateAppointment   = 600
  UpdateAppointmentStatus = 600
}

function ConvertTo-TebraXmlText([string]$Value) {
  if ($null -eq $Value) { return "" }
  return ($Value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace('"', "&quot;").Replace("'", "&apos;"))
}

function Format-TebraTag([string]$Name, $Value) {
  if ($null -eq $Value -or "$Value" -eq "") { return "" }
  $text = ConvertTo-TebraXmlText ([string]$Value)
  return "<$Name>$text</$Name>"
}

function Import-MedSlotEnv {
  $root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  foreach ($name in @(".env.local", ".env")) {
    $path = Join-Path $root $name
    if (-not (Test-Path $path)) { continue }
    foreach ($line in Get-Content $path) {
      $trimmed = $line.Trim()
      if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
      $pair = $trimmed -split "=", 2
      if ($pair.Count -ne 2) { continue }
      $key = $pair[0].Trim()
      $current = [Environment]::GetEnvironmentVariable($key, "Process")
      if ([string]::IsNullOrWhiteSpace($current)) {
        [Environment]::SetEnvironmentVariable($key, $pair[1].Trim(), "Process")
      }
    }
  }
}

function Get-TebraConfig {
  Import-MedSlotEnv
  $customerKey = $env:TEBRA_CUSTOMER_KEY
  $user = $env:TEBRA_USER
  $password = $env:TEBRA_PASSWORD
  $practiceName = $env:TEBRA_PRACTICE_NAME
  if ([string]::IsNullOrWhiteSpace($customerKey) -or [string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($password) -or [string]::IsNullOrWhiteSpace($practiceName)) {
    throw "Set TEBRA_CUSTOMER_KEY, TEBRA_USER, TEBRA_PASSWORD, and TEBRA_PRACTICE_NAME in .env.local or the environment."
  }
  $endpoint = $env:TEBRA_ENDPOINT
  if ([string]::IsNullOrWhiteSpace($endpoint)) { $endpoint = $script:TebraEndpoint }
  return @{
    CustomerKey  = $customerKey.Trim()
    User         = $user.Trim()
    Password     = $password
    PracticeName = $practiceName.Trim()
    PracticeId   = $env:TEBRA_PRACTICE_ID
    Endpoint     = $endpoint.Trim()
  }
}

function Format-TebraUtc([datetime]$Instant) {
  $utc = $Instant.ToUniversalTime()
  return $utc.ToString("M/d/yyyy h:mm:ss tt", [cultureinfo]::InvariantCulture)
}

function Format-TebraIso([datetime]$Instant) {
  return $Instant.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

function Get-TebraRequestHeader($Config) {
  return "<RequestHeader>$(Format-TebraTag CustomerKey $Config.CustomerKey)$(Format-TebraTag Password $Config.Password)$(Format-TebraTag User $Config.User)</RequestHeader>"
}

function New-TebraEnvelope([string]$Operation, [string]$RequestInner) {
  return @"
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <$Operation xmlns="$script:TebraNamespace">
      <request>$RequestInner</request>
    </$Operation>
  </soap:Body>
</soap:Envelope>
"@
}

function Get-TebraLocalNodes([xml]$Document, [string]$LocalName) {
  return @($Document.SelectNodes("//*[local-name()='$LocalName']"))
}

function Get-TebraChildText($Node, [string]$LocalName) {
  if ($null -eq $Node) { return "" }
  foreach ($child in @($Node.ChildNodes)) {
    if ($child.LocalName -and ($child.LocalName -ieq $LocalName)) {
      return "$($child.InnerText)".Trim()
    }
  }
  return ""
}

function Invoke-TebraOperation([string]$Operation, [string]$RequestInner) {
  $config = Get-TebraConfig
  $gap = 500
  if ($script:TebraGapMs.ContainsKey($Operation)) { $gap = $script:TebraGapMs[$Operation] }
  if ($script:TebraLastCall.ContainsKey($Operation)) {
    $elapsed = [int]([datetime]::UtcNow - $script:TebraLastCall[$Operation]).TotalMilliseconds
    if ($elapsed -lt $gap) { Start-Sleep -Milliseconds ($gap - $elapsed) }
  }
  $script:TebraLastCall[$Operation] = [datetime]::UtcNow

  $body = New-TebraEnvelope $Operation $RequestInner
  $action = '"' + $script:TebraNamespace + 'KareoServices/' + $Operation + '"'
  $headers = @{ SOAPAction = $action }
  $response = Invoke-WebRequest -Uri $config.Endpoint -Method Post -ContentType "text/xml; charset=utf-8" -Headers $headers -Body $body -UseBasicParsing
  [xml]$document = $response.Content

  $fault = Get-TebraLocalNodes $document "faultstring" | Select-Object -First 1
  if ($fault) { throw $fault.InnerText }

  $isError = Get-TebraChildText (Get-TebraLocalNodes $document "ErrorResponse" | Select-Object -First 1) "IsError"
  if ($isError -eq "true") {
    $message = Get-TebraChildText (Get-TebraLocalNodes $document "ErrorResponse" | Select-Object -First 1) "ErrorMessage"
    if ([string]::IsNullOrWhiteSpace($message)) { $message = "Tebra returned an error." }
    throw $message
  }

  $security = Get-TebraLocalNodes $document "SecurityResponse" | Select-Object -First 1
  if ($security) {
    $authenticated = Get-TebraChildText $security "Authenticated"
    $authorized = Get-TebraChildText $security "Authorized"
    $resultText = Get-TebraChildText $security "SecurityResult"
    if ($authenticated -eq "false") {
      if ([string]::IsNullOrWhiteSpace($resultText)) { $resultText = "Tebra could not authenticate this customer key." }
      throw $resultText
    }
    if ($authorized -eq "false") {
      if ([string]::IsNullOrWhiteSpace($resultText)) { $resultText = "This Tebra user is not allowed to schedule." }
      throw $resultText
    }
  }

  return $document
}

function Get-TebraPractice {
  $config = Get-TebraConfig
  $fields = @("ID", "PracticeName", "Phone", "PracticeAddressLine1", "PracticeCity", "PracticeState", "Active") | ForEach-Object { Format-TebraTag $_ "true" }
  $inner = "$(Get-TebraRequestHeader $config)<Fields>$($fields -join '')</Fields><Filter>$(Format-TebraTag PracticeName $config.PracticeName)</Filter>"
  $document = Invoke-TebraOperation "GetPractices" $inner
  $rows = Get-TebraLocalNodes $document "PracticeData"
  $match = $rows | Where-Object { (Get-TebraChildText $_ "PracticeName") -eq $config.PracticeName } | Select-Object -First 1
  if (-not $match) { $match = $rows | Select-Object -First 1 }
  if (-not $match) { throw "No Tebra practice matched '$($config.PracticeName)'." }
  return [pscustomobject]@{
    Id   = Get-TebraChildText $match "ID"
    Name = Get-TebraChildText $match "PracticeName"
  }
}

function Get-TebraProviders {
  $config = Get-TebraConfig
  $fields = @("ID", "FullName", "FirstName", "LastName", "SpecialtyName", "Degree", "Active", "Type") | ForEach-Object { Format-TebraTag $_ "true" }
  $filter = "$(Format-TebraTag PracticeName $config.PracticeName)$(Format-TebraTag Type 'Normal Provider')"
  $inner = "$(Get-TebraRequestHeader $config)<Fields>$($fields -join '')</Fields><Filter>$filter</Filter>"
  $document = Invoke-TebraOperation "GetProviders" $inner
  return @(Get-TebraLocalNodes $document "ProviderData" | Where-Object {
      (Get-TebraChildText $_ "Active") -ne "false" -and (Get-TebraChildText $_ "Type") -notmatch "referring"
    } | ForEach-Object {
      $name = Get-TebraChildText $_ "FullName"
      if ([string]::IsNullOrWhiteSpace($name)) {
        $name = "$(Get-TebraChildText $_ 'FirstName') $(Get-TebraChildText $_ 'LastName')".Trim()
      }
      [pscustomobject]@{
        Id        = Get-TebraChildText $_ "ID"
        Name      = $name
        Specialty = Get-TebraChildText $_ "SpecialtyName"
      }
    })
}

function Get-TebraLocations([string]$PracticeId) {
  $config = Get-TebraConfig
  $fields = @("ID", "Name", "AddressLine1", "City", "State", "Phone", "PracticeID", "PracticeName") | ForEach-Object { Format-TebraTag $_ "true" }
  $filter = "$(Format-TebraTag PracticeName $config.PracticeName)$(Format-TebraTag PracticeID $PracticeId)"
  $ns = $script:TebraLocationNamespace
  $inner = "$(Get-TebraRequestHeader $config)<Fields xmlns=`"$ns`">$($fields -join '')</Fields><Filter xmlns=`"$ns`">$filter</Filter>"
  $document = Invoke-TebraOperation "GetServiceLocations" $inner
  return @(Get-TebraLocalNodes $document "ServiceLocationData" | ForEach-Object {
      [pscustomobject]@{
        Id   = Get-TebraChildText $_ "ID"
        Name = Get-TebraChildText $_ "Name"
      }
    })
}

function Get-TebraReasons([string]$PracticeId) {
  $config = Get-TebraConfig
  $inner = "$(Get-TebraRequestHeader $config)$(Format-TebraTag PracticeId $PracticeId)"
  $document = Invoke-TebraOperation "GetAppointmentReasons" $inner
  return @(Get-TebraLocalNodes $document "AppointmentReasonData" | ForEach-Object {
      [pscustomobject]@{
        Id       = Get-TebraChildText $_ "AppointmentReasonId"
        Name     = Get-TebraChildText $_ "Name"
        Minutes  = Get-TebraChildText $_ "DefaultDurationMinutes"
      }
    })
}

function Get-TebraAppointments([datetime]$From, [datetime]$To) {
  $config = Get-TebraConfig
  $fields = @(
    "ID", "StartDate", "EndDate", "AllDay", "ConfirmationStatus", "PatientID", "PatientFullName",
    "ServiceLocationID", "ServiceLocationName", "AppointmentReason1", "AppointmentDuration",
    "ResourceID1", "ResourceName1", "ResourceTypeID1",
    "ResourceID2", "ResourceName2", "ResourceTypeID2",
    "ResourceID3", "ResourceName3", "ResourceTypeID3"
  ) | ForEach-Object { Format-TebraTag $_ "true" }
  $filter = @(
    (Format-TebraTag PracticeName $config.PracticeName),
    (Format-TebraTag StartDate (Format-TebraUtc $From)),
    (Format-TebraTag EndDate (Format-TebraUtc $To)),
    (Format-TebraTag TimeZoneOffsetFromGMT "0"),
    (Format-TebraTag Type "P")
  ) -join ""
  $inner = "$(Get-TebraRequestHeader $config)<Fields>$($fields -join '')</Fields><Filter>$filter</Filter>"
  $document = Invoke-TebraOperation "GetAppointments" $inner
  return @(Get-TebraLocalNodes $document "AppointmentData" | ForEach-Object {
      [pscustomobject]@{
        Id       = Get-TebraChildText $_ "ID"
        Start    = Get-TebraChildText $_ "StartDate"
        End      = Get-TebraChildText $_ "EndDate"
        Status   = Get-TebraChildText $_ "ConfirmationStatus"
        Patient  = Get-TebraChildText $_ "PatientFullName"
        PatientId = Get-TebraChildText $_ "PatientID"
        Location = Get-TebraChildText $_ "ServiceLocationName"
        Reason   = Get-TebraChildText $_ "AppointmentReason1"
        Provider = Get-TebraChildText $_ "ResourceName1"
      }
    })
}

function Find-TebraPatients([string]$FirstName, [string]$LastName, [string]$DateOfBirth) {
  $config = Get-TebraConfig
  $fields = @("ID", "FirstName", "LastName", "DOB", "EmailAddress", "MobilePhone") | ForEach-Object { Format-TebraTag $_ "true" }
  $filter = @(
    (Format-TebraTag PracticeName $config.PracticeName),
    (Format-TebraTag FirstName $FirstName),
    (Format-TebraTag LastName $LastName),
    (Format-TebraTag FromDateOfBirth $DateOfBirth),
    (Format-TebraTag ToDateOfBirth $DateOfBirth)
  ) -join ""
  $inner = "$(Get-TebraRequestHeader $config)<Fields>$($fields -join '')</Fields><Filter>$filter</Filter>"
  $document = Invoke-TebraOperation "GetPatients" $inner
  return @(Get-TebraLocalNodes $document "PatientData" | ForEach-Object {
      [pscustomobject]@{
        Id        = Get-TebraChildText $_ "ID"
        FirstName = Get-TebraChildText $_ "FirstName"
        LastName  = Get-TebraChildText $_ "LastName"
        Dob       = Get-TebraChildText $_ "DOB"
      }
    })
}

function New-TebraTentativeVisit {
  param(
    [string]$PracticeId,
    [string]$PatientId,
    [string]$ProviderId,
    [string]$ServiceLocationId,
    [string]$ReasonId,
    [datetime]$Start,
    [datetime]$End,
    [string]$Mode = "InOffice",
    [string]$Name = "MedSlot test",
    [string]$Notes = "Tentative test from scripts/tebra. Cancel after checking Tebra."
  )
  $config = Get-TebraConfig
  $appointment = @(
    (Format-TebraTag AppointmentMode $Mode),
    (Format-TebraTag AppointmentName $Name),
    (Format-TebraTag AppointmentReasonId $ReasonId),
    (Format-TebraTag AppointmentStatus "Tentative"),
    (Format-TebraTag AppointmentType "P"),
    (Format-TebraTag EndTime (Format-TebraIso $End)),
    (Format-TebraTag IsRecurring "false"),
    (Format-TebraTag Notes $Notes),
    "<PatientSummary>$(Format-TebraTag PatientId $PatientId)</PatientSummary>",
    (Format-TebraTag PracticeId $PracticeId),
    (Format-TebraTag ProviderId $ProviderId),
    (Format-TebraTag ServiceLocationId $ServiceLocationId),
    (Format-TebraTag StartTime (Format-TebraIso $Start)),
    (Format-TebraTag WasCreatedOnline "true")
  ) -join ""
  $inner = "$(Get-TebraRequestHeader $config)<Appointment>$appointment</Appointment>"
  $document = Invoke-TebraOperation "CreateAppointment" $inner
  $created = Get-TebraLocalNodes $document "Appointment" | Select-Object -First 1
  $id = Get-TebraChildText $created "AppointmentId"
  if ([string]::IsNullOrWhiteSpace($id)) { throw "Tebra did not return an appointment id." }
  return $id
}

function Set-TebraVisitStatus([string]$AppointmentId, [string]$Status) {
  $config = Get-TebraConfig
  $appointment = "$(Format-TebraTag AppointmentId $AppointmentId)$(Format-TebraTag AppointmentStatus $Status)"
  $inner = "$(Get-TebraRequestHeader $config)<Appointment>$appointment</Appointment>"
  Invoke-TebraOperation "UpdateAppointmentStatus" $inner | Out-Null
}
