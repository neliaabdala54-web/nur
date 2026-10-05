$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "Base_de_Dados_Oficial_Bot_Nur_Maxixe_Etapas_1_a_12_PARTE_12.docx"
$outputPath = Join-Path $projectRoot "knowledge\maxixe-official.json"

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "O documento oficial de Maxixe nao foi encontrado: $sourcePath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
  $documentEntry = $archive.GetEntry("word/document.xml")
  if (-not $documentEntry) {
    throw "O documento oficial nao contem a estrutura esperada de um ficheiro Word."
  }

  $reader = [System.IO.StreamReader]::new($documentEntry.Open())
  try {
    [xml]$document = $reader.ReadToEnd()
  }
  finally {
    $reader.Dispose()
  }
}
finally {
  $archive.Dispose()
}

$namespace = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
$namespace.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
$tables = $document.SelectNodes("//w:tbl", $namespace)
if ($tables.Count -lt 12) {
  throw "O documento nao contem as tabelas de estabelecimentos e conhecimento local esperadas."
}

function Get-CellValues($row) {
  $values = [System.Collections.Generic.List[string]]::new()
  foreach ($cell in $row.SelectNodes("./w:tc", $namespace)) {
    $value = ($cell.SelectNodes(".//w:t", $namespace) | ForEach-Object { $_.InnerText }) -join " "
    $values.Add($value.Trim())
  }
  return ,$values.ToArray()
}

function ConvertTo-SearchText([string]$value) {
  if ($null -eq $value) { return "" }
  return (($value.Normalize([Text.NormalizationForm]::FormD) -replace "\p{Mn}", "").ToLowerInvariant())
}

function Clean-Value([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }
  $normalized = ConvertTo-SearchText $value.Trim()
  if ($normalized -match "^(nao identificado|nao disponivel|a identificar|n/?d|[-])$") { return $null }
  return $value.Trim()
}

function Get-RecordCategory([int]$tableIndex, [string]$subcategory, [string]$name) {
  $label = ConvertTo-SearchText ($subcategory + " " + $name)
  switch ($tableIndex) {
    0 {
      if ($label -match "padaria|pastelaria|pao") { return "Padarias" }
      if ($label -match "bar|snack|lanchonete|cafe|cafeteria") { return "Bares e lanchonetes" }
      return "Restaurantes"
    }
    1 { return "Escolas" }
    2 {
      if ($label -match "tecnico|profissional|formacao") { return "Institutos t${acuteE}cnico-profissionais" }
      if ($label -match "universidade|university|unisave") { return "Universidades" }
      return "Institutos superiores"
    }
    3 {
      if ($label -match "farmacia") { return "Farm${acuteA}cias" }
      if ($label -match "hospital") { return "Hospitais" }
      if ($label -match "centro.*saude") { return "Centros de sa${acuteU}de" }
      return "Hospitais"
    }
    4 {
      if ($label -match "atm|caixa automatico|multibanco") { return "ATMs" }
      return "Bancos"
    }
    5 {
      if ($label -match "supermercado|supermarket") { return "Supermercados" }
      return "Lojas"
    }
    6 { return "Mercados" }
    7 {
      if ($label -match "agricultura|agroindustria|agricola|coco") { return "Agricultura" }
      if ($label -match "pesca|pescado|fish") { return "Pesca" }
      if ($label -match "telecom|tecnologia|informatica|internet") { return "Tecnologia" }
      if ($label -match "servico profissional|advocacia|contabilidade|consultoria") { return "Servi${cedilla}os profissionais" }
      return "Empresas"
    }
    8 {
      if ($label -match "guest.?house|casa de hospedes") { return "Guest houses" }
      if ($label -match "pensao") { return "Pens${tildeO}es" }
      if ($label -match "hotel|motel|alojamento") { return "Hot${acuteE}is" }
      return "Pens${tildeO}es"
    }
    9 {
      if ($label -match "mesquita|islam|muslim") { return "Mesquitas" }
      return "Igrejas"
    }
    10 {
      if ($label -match "turismo|turistico|tour|transfer") { return "Turismo" }
      return "Transportes"
    }
    default { return "Outros serviços locais" }
  }
}

function Get-NormalizedState([string]$value) {
  $state = Clean-Value $value
  if (-not $state) { return $null }
  $normalized = (ConvertTo-SearchText $state).ToUpperInvariant().Trim()
  if ($normalized -match "CONFIRMAR|CONFIRMA") { return "A CONFIRMAR" }
  if ($normalized -match "TEMPORARIAMENTE FECHADO") { return "TEMPORARIAMENTE FECHADO" }
  if ($normalized -match "DADO ANTIGO|DESATUALIZADO|ANTIGO") { return "DADO ANTIGO" }
  if ($normalized -match "FECHADO") { return "FECHADO" }
  if ($normalized -match "DUPLICADO") { return "DUPLICADO" }
  if ($normalized -match "ATIVO|ABERTO") { return "ATIVO" }
  return $state
}

function Get-NormalizedConfidence([string]$value) {
  $confidence = Clean-Value $value
  if (-not $confidence) { return $null }
  $normalized = (ConvertTo-SearchText $confidence).ToUpperInvariant().Trim()
  if ($normalized -match "^(ALTA|HIGH)$") { return "ALTA" }
  if ($normalized -match "^(MEDIA|MEDIUM)$") { return "M${uppercaseAcuteE}DIA" }
  if ($normalized -match "^(BAIXA|LOW)$") { return "BAIXA" }
  return $confidence
}

$districtFacts = [System.Collections.Generic.List[object]]::new()
$identityFacts = [System.Collections.Generic.List[object]]::new()
$records = [System.Collections.Generic.List[object]]::new()
$acuteA = [string][char]0x00E1
$acuteE = [string][char]0x00E9
$acuteI = [string][char]0x00ED
$uppercaseAcuteE = [string][char]0x00C9
$acuteO = [string][char]0x00F3
$acuteU = [string][char]0x00FA
$tildeA = [string][char]0x00E3
$tildeO = [string][char]0x00F5
$cedilla = [string][char]0x00E7
$categorySet = @(
  "Restaurantes", "Bares e lanchonetes", "Padarias", "Escolas", "Universidades",
  "Institutos superiores", "Institutos t${acuteE}cnico-profissionais", "Hospitais",
  "Centros de sa${acuteU}de", "Farm${acuteA}cias", "Bancos", "ATMs", "Lojas", "Supermercados",
  "Mercados", "Empresas", "Servi${cedilla}os profissionais", "Hot${acuteE}is", "Pens${tildeO}es",
  "Guest houses", "Igrejas", "Mesquitas", "Transportes", "Turismo", "Praias",
  "Locais de interesse", "Cultura", "Hist${acuteO}ria", "Agricultura", "Pesca",
  "Tecnologia", "Telecomunica${cedilla}${tildeO}es", "Outros servi${cedilla}os locais"
)
$tableCategories = @(
  "Restaurantes e alimenta${cedilla}${tildeA}o", "Escolas", "Universidades e institutos",
  "Sa${acuteU}de e farm${acuteA}cias", "Bancos e finan${cedilla}as", "Com${acuteE}rcio e lojas", "Mercados e feiras",
  "Empresas e servi${cedilla}os", "Hot${acuteE}is e alojamento", "Religi${tildeA}o", "Transportes e turismo"
)
$sourceName = Split-Path -Leaf $sourcePath

for ($tableIndex = 0; $tableIndex -le 10; $tableIndex++) {
  $rows = $tables[$tableIndex].SelectNodes("./w:tr", $namespace)
  $expectedHeaders = @("Nome", "Subcategoria", "Bairro/Localiza${cedilla}${tildeA}o", "Contacto", "Hor${acuteA}rio", "Estado", "Confian${cedilla}a", "Observa${cedilla}${tildeO}es")
  $headers = Get-CellValues $rows[0]
  if ((($headers | ForEach-Object { ConvertTo-SearchText $_ }) -join "|") -ne (($expectedHeaders | ForEach-Object { ConvertTo-SearchText $_ }) -join "|")) {
    throw "O formato da tabela $($tableIndex + 1) mudou; a importação foi interrompida para proteger a base original."
  }

  for ($rowIndex = 1; $rowIndex -lt $rows.Count; $rowIndex++) {
    $values = Get-CellValues $rows[$rowIndex]
    if ($values.Count -ne 8) {
      throw "A tabela $($tableIndex + 1), linha $($rowIndex + 1), nao tem os oito campos originais esperados."
    }
    if ([string]::IsNullOrWhiteSpace($values[0])) {
      throw "A tabela $($tableIndex + 1), linha $($rowIndex + 1), nao tem nome; a importacao foi interrompida para evitar perda de dados."
    }

    $location = Clean-Value $values[2]
    $contact = Clean-Value $values[3]
    $hours = Clean-Value $values[4]
    $notes = Clean-Value $values[7]
    $subcategory = Clean-Value $values[1]
    $phone = $null
    $email = $null
    $website = $null
    $plusCode = $null
    $neighbourhood = $null
    $address = $null
    $latitude = $null
    $longitude = $null

    if ($contact) {
      if ($contact -match "(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}") {
        $email = $Matches[0]
      }
      if ($contact -match "https?://[^\s,;]+") {
        $website = $Matches[0].TrimEnd(".", ",", ";")
      }
      if ($contact -match "^\s*(?:\+258[\s-]*)?\d[\d().\s-]{5,}\d\s*$") {
        $phone = $contact.Trim()
      }
    }

    if ($location) {
      if ($location -match "\b[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}\b") {
        $plusCode = $Matches[0].ToUpperInvariant()
      }
      if ($location -match "(?i)^\s*(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)") {
        $candidateLatitude = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture)
        $candidateLongitude = [double]::Parse($Matches[2], [Globalization.CultureInfo]::InvariantCulture)
        if ([Math]::Abs($candidateLatitude) -le 90 -and [Math]::Abs($candidateLongitude) -le 180) {
          $latitude = $candidateLatitude
          $longitude = $candidateLongitude
        }
      }
      if ($location -match "(?i)\b(av(?:enida)?\.?|rua|estrada|en\s*\d+|r\s*\d+)\b") {
        $address = $location.Trim()
      }
      $neighbourhoodNames = @(
        "Chambone 6", "Chambone 4", "Chambone A", "Chambone B",
        "Nhaguiviga", "Nhanguila", "Macuamene", "Macupula", "Malalane",
        "Eduardo Mondlane", "Nhambiho", "Nhabanda", "Nhamaxaxa",
        "Tinga-Tinga", "Mabil A", "Mabil B", "Dambo", "Bembe", "Mawewe",
        "Manhala", "Rumbana", "Chambone", "Tinga-Tinga"
      )
      foreach ($candidate in $neighbourhoodNames) {
        if ($location -match ("(?i)(?<![\p{L}\p{N}])" + [Regex]::Escape($candidate) + "(?![\p{L}\p{N}])")) {
          $neighbourhood = $candidate
          break
        }
      }
    }

    $sourceRowNumber = $rowIndex + 1
    $confidence = Get-NormalizedConfidence $values[6]
    $records.Add([ordered]@{
      id = "DOCX-T$($tableIndex + 1)-R$($sourceRowNumber.ToString('D3'))"
      name = $values[0].Trim()
      category = Get-RecordCategory $tableIndex ($values[1]) ($values[0])
      subcategory = $subcategory
      city = "Maxixe"
      neighbourhood = $neighbourhood
      location = $location
      address = $address
      plusCode = $plusCode
      latitude = $latitude
      longitude = $longitude
      phone = $phone
      whatsapp = $null
      email = $email
      website = $website
      hours = $hours
      services = $null
      description = $null
      source = $null
      verifiedAt = $null
      state = Get-NormalizedState $values[5]
      confidence = $confidence
      observations = $notes
      recordProvenance = [ordered]@{
        document = $sourceName
        tableIndex = $tableIndex + 1
        rowIndex = $sourceRowNumber
        categoryHeading = $tableCategories[$tableIndex]
        sourceValues = [ordered]@{
          name = $values[0]
          subcategory = $values[1]
          "neighbourhoodOrLocation" = $values[2]
          contact = $values[3]
          hours = $values[4]
          state = $values[5]
          confidence = $values[6]
          observations = $values[7]
        }
      }
    })
  }
}

$localRows = $tables[11].SelectNodes("./w:tr", $namespace)
$localHeaders = Get-CellValues $localRows[0]
if ((($localHeaders | ForEach-Object { ConvertTo-SearchText $_ }) -join "|") -ne "tema|conhecimento para o nur") {
  throw "O formato da tabela de conhecimento geral de Maxixe mudou."
}
for ($rowIndex = 1; $rowIndex -lt $localRows.Count; $rowIndex++) {
  $values = Get-CellValues $localRows[$rowIndex]
  if ($values.Count -ne 2 -or [string]::IsNullOrWhiteSpace($values[1])) { continue }
  $districtFacts.Add([ordered]@{
    id = "DOCX-T12-R$(($rowIndex + 1).ToString('D3'))"
    topic = $values[0]
    text = $values[1]
    city = "Maxixe"
    source = $null
    verifiedAt = $null
    state = $null
    confidence = $null
    provenance = [ordered]@{
      document = $sourceName
      tableIndex = 12
      rowIndex = $rowIndex + 1
    }
  })
}

$body = $document.SelectSingleNode("//w:body", $namespace)
foreach ($paragraph in $body.SelectNodes("./w:p", $namespace)) {
  $text = ($paragraph.SelectNodes(".//w:t", $namespace) | ForEach-Object { $_.InnerText }) -join ""
  if ($text -match "^\s*(INH-714|INH-715|INH-716)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(ALTA|MEDIA|BAIXA)\s*$") {
    $identity = $Matches.Clone()
    $identityFacts.Add([ordered]@{
      id = $identity[1]
      topic = "Identidade do Bot Nur"
      text = $identity[2].Trim()
      source = $identity[3].Trim()
      verifiedAt = $null
      state = $null
      confidence = Get-NormalizedConfidence $identity[4]
      provenance = [ordered]@{
        document = $sourceName
      }
    })
    continue
  }
  if ($text -match "^\s*(Criadora|Forma..o|Origem|Significado de Nur):\s*(.+?)\s*$") {
    $identity = $Matches.Clone()
    $identityOrdinal = $identityFacts.Count + 1
    $identityFacts.Add([ordered]@{
      id = "DOCX-IDENTITY-$($identityOrdinal.ToString('D3'))"
      topic = "Identidade do Bot Nur"
      text = "$($identity[1]): $($identity[2])"
      source = $null
      verifiedAt = $null
      state = $null
      confidence = $null
      provenance = [ordered]@{
        document = $sourceName
      }
    })
  }
}

$documentMetadata = [ordered]@{
  schemaVersion = 1
  title = "Base de Dados Oficial do Bot Nur - Maxixe"
  locale = "pt-MZ"
  geographicScope = [ordered]@{
    country = "Mo${cedilla}ambique"
    province = "Inhambane"
    city = "Maxixe"
    policy = "Nao misturar Cidade de Inhambane, Tofo, Barra, Massinga, Vilankulo ou outras localidades com Maxixe."
  }
  sourceDocument = $sourceName
  importedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  unfilledFieldsRemainNull = $true
  categories = $categorySet
  categoriesInSourceOrder = $tableCategories
  reliabilityLevels = @("ALTA", "M${acuteE}DIA", "BAIXA")
  recordStates = @("ATIVO", "A CONFIRMAR", "FECHADO", "TEMPORARIAMENTE FECHADO", "DADO ANTIGO", "DUPLICADO")
  recordCount = $records.Count
  factCount = ($districtFacts.Count + $identityFacts.Count)
  notice = "Converte os registos estruturados das primeiras onze tabelas da base t${acuteE}cnica oficial. Campos indispon${acuteI}veis permanecem null; recordProvenance.sourceValues preserva os valores originais. Importa${cedilla}${tildeA}o n${tildeA}o equivale a rever ou confirmar dados din${acuteA}micos."
  facts = @($districtFacts.ToArray()) + @($identityFacts.ToArray())
  records = @($records.ToArray())
}

$json = ConvertTo-Json -InputObject $documentMetadata -Depth 15
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($outputPath, $json + [Environment]::NewLine, $utf8NoBom)

Write-Output "JSON oficial criado: $outputPath"
Write-Output "Registos originais convertidos: $($records.Count)"
Write-Output "Factos locais e de identidade: $($documentMetadata.factCount)"
