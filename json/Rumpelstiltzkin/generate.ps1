$content = Get-Content "C:\Users\Vogel\Documents\OpenCode\Rumpelstiltzkin.txt" -Raw -Encoding UTF8
# Remove BOM if present
$content = $content -replace '^\xEF\xBB\xBF', ''

$pages = @()
$pageNum = 1

# Find all brackets and their positions
$pattern = '\[([^\]]+)\]'
$matches = [regex]::Matches($content, $pattern)

for ($i = 0; $i -lt $matches.Count; $i++) {
    $bracket = $matches[$i].Groups[1].Value
    $bracketEnd = $matches[$i].Index + $matches[$i].Length
    
    # Caption is text from end of current bracket to start of next bracket (or end of content)
    if ($i + 1 -lt $matches.Count) {
        $nextBracketStart = $matches[$i + 1].Index
        $caption = $content.Substring($bracketEnd, $nextBracketStart - $bracketEnd).Trim()
    } else {
        $caption = $content.Substring($bracketEnd).Trim()
    }
    
    # Remove trailing "Total frames: 102" line if present
    $caption = $caption -replace '\s*Total frames: \d+\s*$', ''
    $caption = $caption.Trim()
    
    # Clean up caption: remove leading/trailing whitespace and ensure it ends with period
    # Remove any leading punctuation or whitespace
    $caption = $caption -replace '^\s+', ''
    
    # If caption starts with a quote, keep it as is
    # If caption doesn't end with punctuation, add a period
    if ($caption -and $caption[-1] -notmatch '[.!?\"]') {
        $caption = $caption + '.'
    }
    
    # Extract characters from bracket content
    # Characters are words in the bracket that are likely character names
    # Simple heuristic: words that are capitalized and not common words
    $characters = @()
    $bracketLower = $bracket.ToLower()
    
    # Map common bracket descriptions to character names
    $characterMap = @{
        'poor miller' = 'Miller'
        'beautiful daughter' = 'Daughter'
        'one day' = ''
        'with the King' = 'King'
        'of some importance' = ''
        'daughter spins straw' = ''
        'talent worth having' = ''
        'to the miller' = 'Miller'
        'as you say' = ''
        'to-morrow' = ''
        'girl brought' = 'Daughter'
        'into a room' = ''
        'and spindle' = ''
        'spin all night' = ''
        'you shall die' = ''
        'door closed' = ''
        'left her alone' = ''
        'sitting down' = ''
        "didn't know" = ''
        "hadn't the least idea" = ''
        'began to cry' = ''
        'door opened' = ''
        'tiny little man' = 'Rumpelstiltzkin'
        'why are you crying' = ''
        'have to spin straw' = ''
        "how it's done" = ''
        'if I spin it' = ''
        'necklace' = ''
        'little man took necklace' = 'Rumpelstiltzkin'
        'whir' = ''
        'bobbin was full' = ''
        'another bobbin' = ''
        'wheel went round' = ''
        'all the straw' = ''
        'bobbins full of gold' = ''
        'sun rose' = ''
        'King astonished' = 'King'
        'heart lusted' = ''
        'another room' = ''
        'much bigger' = ''
        'spin it all' = ''
        "didn't know" = ''
        'tiny little man' = 'Rumpelstiltzkin'
        "what'll you give" = ''
        'ring' = ''
        "manikin took ring" = 'Rumpelstiltzkin'
        'wheel again' = ''
        'all the straw' = ''
        'King pleased' = 'King'
        'greed not satisfied' = ''
        'yet bigger room' = ''
        'spin it all' = ''
        'shall become wife' = ''
        'thought to himself' = 'King'
        'richest wife' = ''
        'alone again' = ''
        "what'll you give" = ''
        'nothing more' = ''
        'first child' = ''
        'thought' = ''
        'no other way' = ''
        'promised' = ''
        'spun into gold' = ''
        'morning came' = ''
        'made her wife' = 'King'
        'became a queen' = 'Daughter'
        'year passed' = ''
        'thought no more' = ''
        'little man appeared' = 'Rumpelstiltzkin'
        'give me child' = 'Rumpelstiltzkin'
        'Queen in state' = 'Queen'
        'offered riches' = ''
        'manikin refused' = 'Rumpelstiltzkin'
        'than all treasures' = ''
        'Queen cried' = 'Queen'
        'manikin sorry' = 'Rumpelstiltzkin'
        'three days' = ''
        'keep your child' = ''
        'pondered all night' = 'Queen'
        'sent messenger' = 'Queen'
        'names far and near' = ''
        'first day' = ''
        'Belshazzar' = ''
        'not my name' = ''
        'second day' = ''
        'uncommon names' = ''
        'when he appeared' = ''
        'Sheepshanks' = ''
        'Spindleshanks' = ''
        'not my name' = ''
        'third day' = ''
        'not able to find' = ''
        'high hill' = ''
        'foxes and hares' = ''
        'little house' = ''
        'grotesque little man' = 'Rumpelstiltzkin'
        'hopping on one leg' = ''
        "Rumpelstiltzkin's song" = ''
        'Rumpelstiltzkin' = 'Rumpelstiltzkin'
        "Queen's delight" = 'Queen'
        'little man arrived' = 'Rumpelstiltzkin'
        "what's my name" = ''
        'wrong names' = ''
        'demon told you' = ''
        'little man screamed' = 'Rumpelstiltzkin'
        'drove foot into ground' = 'Rumpelstiltzkin'
        'tore himself in two' = 'Rumpelstiltzkin'
    }
    
    if ($characterMap.ContainsKey($bracket)) {
        $charStr = $characterMap[$bracket]
        if ($charStr) {
            $characters = $charStr
        } else {
            $characters = ''
        }
    } else {
        # Default: check if bracket contains recognizable names
        if ($bracket -match 'king|kingdom') { $characters = 'King' }
        elseif ($bracket -match 'queen') { $characters = 'Queen' }
        elseif ($bracket -match 'miller') { $characters = 'Miller' }
        elseif ($bracket -match 'daughter|girl|she') { $characters = 'Daughter' }
        elseif ($bracket -match 'man|manikin|rumpelstiltzkin') { $characters = 'Rumpelstiltzkin' }
        else { $characters = '' }
    }
    
    $pageId = "Rumpelstiltzkin_MM{0:D3}" -f $pageNum
    
    $page = @{
        id = $pageId
        filename = "$pageId.json"
        interpOrder = $false
        characters = $characters
        caption = $caption
        description = $bracket
    }
    
    $pages += $page
    $pageNum++
}

# Create manifest
$manifest = @{
    width = 720
    height = 720
    format = 'png'
    name = 'Rumpelstiltzkin'
    captionFontSize = 14
    defaultTransitionDuration = 2000
    pages = $pages
}

$manifestPath = "C:\Users\Vogel\Documents\OpenCode\Rumpelstiltzkin\Rumpelstiltzkin_manifest.json"
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "Created manifest with $($pages.Count) pages"

# Create individual page JSONs
foreach ($page in $pages) {
    $pageJson = @{
        canvasParams = @{
            width = 720
            height = 720
            backgroundColor = '#f0ebe8'
        }
        marks = @()
    }
    
    $pagePath = "C:\Users\Vogel\Documents\OpenCode\Rumpelstiltzkin\$($page.filename)"
    $pageJson | ConvertTo-Json -Depth 10 | Set-Content -Path $pagePath -Encoding UTF8
    Write-Host "Created: $($page.filename) - $($page.description)"
}

Write-Host "`nDone! Created $($pages.Count) page files and manifest."
