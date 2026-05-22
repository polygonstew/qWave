# QueueWave Desktop
### Winamp-style RSS player — Windows & Linux
### C# · Avalonia UI · LibVLCSharp · .NET 9 / 10

---

## Why these tools

| Decision | Choice | Why |
|---|---|---|
| UI framework | **Avalonia UI** | Truly cross-platform (Win/Linux/Mac), borderless custom windows, WPF-like XAML, actively maintained |
| Audio engine | **LibVLCSharp** | Wraps VLC — handles MP3 streams, podcasts, every codec, network streams out of the box |
| Language | **C# / .NET 10** | Same logic you already have, strong async support for feed fetching |
| RSS parsing | **System.Xml.Linq** | Built in, no extra package needed |

> **Honest caveat on Linux:** Avalonia runs great on most distros. LibVLC needs `libvlc` installed (`sudo apt install libvlc-dev` on Debian/Ubuntu). On CachyOS/Arch: `sudo pacman -S vlc`. Audio works through PipeWire/PulseAudio automatically.

---

## 1. What it will look like

```
┌─────────────────────────────────────────┐  ← borderless, draggable by titlebar
│ QUEUEWAVE              [_][□][×]        │
│─────────────────────────────────────────│
│ [ART]  Title of episode                 │
│        Station name · 42:10 / 1:08:33   │
│ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← progress bar, clickable
│ ⏮  -15  ▶  +30  ⏭    🔈────  1.0×    │
└─────────────────────────────────────────┘
         ↕ toggle panels below

┌─────────────────────────────────────────┐
│ [🔍 FIND] [+ ADD]      // STATIONS      │
│ > Darknet Diaries                    ↻ ✕│
│   No Such Thing as a Fish            ↻ ✕│
│─────────────────────────────────────────│
│ // QUEUE              ↕ NEWEST  ⇌  CLEAR│
│ ▶ 01  Some Episode Title                │
│   02  Another Episode                   │
└─────────────────────────────────────────┘
```

Two windows (like Winamp): **player** always visible, **library panel** toggleable. Both can be dragged independently or snapped together.

---

## 2. Prerequisites

```bash
# Windows — install .NET SDK
winget install Microsoft.DotNet.SDK.10

# Linux (Debian/Ubuntu)
sudo apt install dotnet-sdk-10.0 libvlc-dev libvlccore-dev

# Linux (Arch/CachyOS/Manjaro)
sudo pacman -S dotnet-sdk vlc

# Verify
dotnet --version   # 10.x.x
```

---

## 3. Create the solution

```bash
mkdir QueueWave && cd QueueWave
dotnet new sln -n QueueWave

# Avalonia MVVM template (installs the right project structure)
dotnet new install Avalonia.Templates
dotnet new avalonia.mvvm -n QueueWave.App
dotnet sln add QueueWave.App/QueueWave.App.csproj
```

---

## 4. NuGet packages

```bash
cd QueueWave.App

# Avalonia extras
dotnet add package Avalonia
dotnet add package Avalonia.Desktop
dotnet add package Avalonia.Themes.Fluent
dotnet add package Avalonia.ReactiveUI          # MVVM bindings

# Audio
dotnet add package LibVLCSharp                  # core VLC wrapper
dotnet add package LibVLCSharp.Avalonia         # Avalonia VideoView (for art display too)
dotnet add package VideoLAN.LibVLC.Windows      # bundles libvlc.dll on Windows
# Linux: libvlc comes from the system package manager (step 2 above)

# MVVM
dotnet add package ReactiveUI
dotnet add package CommunityToolkit.Mvvm

# JSON
# System.Text.Json is already in .NET 10 — no install needed
```

Your `.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <BuiltInComNetworkingHttpClient>true</BuiltInComNetworkingHttpClient>
    <RootNamespace>QueueWave</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Avalonia"                   Version="11.*" />
    <PackageReference Include="Avalonia.Desktop"           Version="11.*" />
    <PackageReference Include="Avalonia.Themes.Fluent"     Version="11.*" />
    <PackageReference Include="Avalonia.ReactiveUI"        Version="11.*" />
    <PackageReference Include="LibVLCSharp"                Version="3.*" />
    <PackageReference Include="LibVLCSharp.Avalonia"       Version="3.*" />
    <PackageReference Include="VideoLAN.LibVLC.Windows"    Version="3.*"
                      Condition="$([MSBuild]::IsOSPlatform('Windows'))" />
    <PackageReference Include="CommunityToolkit.Mvvm"      Version="8.*" />
  </ItemGroup>
</Project>
```

---

## 5. Project structure

```
QueueWave.App/
├── App.axaml                  # application entry, theme
├── App.axaml.cs
├── Assets/
│   └── queuewave.ico
├── Models/
│   ├── FeedItem.cs
│   ├── PodcastFeed.cs
│   └── AppState.cs
├── Services/
│   ├── RssService.cs          # fetch + parse XML
│   ├── PlayerService.cs       # LibVLC wrapper
│   ├── PersistenceService.cs  # JSON save/load
│   └── ItunesSearchService.cs # iTunes podcast search API
├── ViewModels/
│   ├── MainViewModel.cs       # player controls
│   └── LibraryViewModel.cs    # feeds + queue
├── Views/
│   ├── PlayerWindow.axaml     # compact always-visible player
│   ├── PlayerWindow.axaml.cs
│   ├── LibraryWindow.axaml    # toggleable library panel
│   └── LibraryWindow.axaml.cs
└── Converters/
    └── TimeSpanConverter.cs
```

---

## 6. Models

### `Models/FeedItem.cs`
```csharp
namespace QueueWave.Models;

public class FeedItem
{
    public string Title       { get; set; } = string.Empty;
    public string AudioUrl    { get; set; } = string.Empty;
    public string ArtUrl      { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Duration    { get; set; } = string.Empty;
    public string PublishDate { get; set; } = string.Empty;
    public long   Timestamp   { get; set; }   // unix ms for sorting
    public string FeedName    { get; set; } = string.Empty;
    public string FeedId      { get; set; } = string.Empty;
    public bool   IsAudio     { get; set; }
}
```

### `Models/PodcastFeed.cs`
```csharp
namespace QueueWave.Models;

public class PodcastFeed
{
    public string         Id          { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string         Name        { get; set; } = string.Empty;
    public string         Url         { get; set; } = string.Empty;
    public string         ArtUrl      { get; set; } = string.Empty;
    public long           LastRefresh { get; set; }
    public List<FeedItem> Items       { get; set; } = [];
}
```

### `Models/AppState.cs`
```csharp
namespace QueueWave.Models;

public class AppState
{
    public int              Version   { get; set; } = 1;
    public DateTime         SavedAt   { get; set; } = DateTime.UtcNow;
    public List<PodcastFeed> Feeds    { get; set; } = [];
    public List<FeedItem>   Queue     { get; set; } = [];
    public string           SortMode  { get; set; } = "manual";
    public double           Volume    { get; set; } = 1.0;
    public float            Speed     { get; set; } = 1.0f;
}
```

---

## 7. RSS Service

```csharp
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using QueueWave.Models;

namespace QueueWave.Services;

public class RssService
{
    private static readonly HttpClient Http = new()
    {
        DefaultRequestHeaders = { { "User-Agent", "QueueWave/1.0" } },
        Timeout = TimeSpan.FromSeconds(15)
    };

    // iTunes namespace
    static readonly XNamespace Itunes = "http://www.itunes.com/dtds/podcast-1.0.dtd";
    static readonly XNamespace Media  = "http://search.yahoo.com/mrss/";

    public async Task<PodcastFeed?> LoadAsync(string url)
    {
        string xml;
        try { xml = await Http.GetStringAsync(url); }
        catch
        {
            // try CORS proxy as fallback — not needed in a native app!
            // Native apps have no CORS restriction — direct fetch always works.
            throw;
        }
        return Parse(xml, url, url);
    }

    public async Task<PodcastFeed?> LoadFromFileAsync(string path)
    {
        var xml = await File.ReadAllTextAsync(path);
        return Parse(xml, Path.GetFileNameWithoutExtension(path), $"__local__:{path}");
    }

    public PodcastFeed? Parse(string xml, string fallbackName, string sourceUrl)
    {
        XDocument doc;
        try { doc = XDocument.Parse(xml); }
        catch { return null; }

        var ch = doc.Root?.Element("channel") ?? doc.Root;
        if (ch is null) return null;

        var name   = ch.Element("title")?.Value?.Trim() ?? fallbackName;
        var chArt  = ch.Element(Itunes + "image")?.Attribute("href")?.Value
                  ?? ch.Element("image")?.Element("url")?.Value
                  ?? string.Empty;

        var feedId = Guid.NewGuid().ToString("N")[..8];

        var items = ch.Elements("item").Concat(ch.Elements("entry"))
            .Select((el, i) => ParseItem(el, i, feedId, name, chArt))
            .ToList();

        return new PodcastFeed
        {
            Id = feedId, Name = name, Url = sourceUrl,
            ArtUrl = chArt, Items = items,
            LastRefresh = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }

    private static FeedItem ParseItem(XElement el, int i, string feedId,
                                      string feedName, string chArt)
    {
        var title    = el.Element("title")?.Value?.Trim() ?? $"Item {i+1}";
        var enc      = el.Element("enclosure");
        var audioUrl = enc?.Attribute("url")?.Value
                    ?? el.Element("link")?.Value
                    ?? el.Element("link")?.Attribute("href")?.Value
                    ?? string.Empty;
        var encType  = enc?.Attribute("type")?.Value ?? string.Empty;
        var isAudio  = encType.StartsWith("audio", StringComparison.OrdinalIgnoreCase)
                    || Regex.IsMatch(audioUrl,
                           @"\.(mp3|m4a|ogg|opus|wav|aac|flac)(\?|$)",
                           RegexOptions.IgnoreCase);

        var itemArt  = el.Element(Itunes + "image")?.Attribute("href")?.Value
                    ?? el.Element(Media + "thumbnail")?.Attribute("url")?.Value
                    ?? chArt;

        var rawDesc  = el.Element(Itunes + "summary")?.Value
                    ?? el.Element("description")?.Value
                    ?? el.Element("summary")?.Value
                    ?? string.Empty;
        var desc     = Regex.Replace(rawDesc, "<.*?>", " ").Trim();
        if (desc.Length > 500) desc = desc[..500] + "…";

        var rawDate  = el.Element("pubDate")?.Value
                    ?? el.Element("published")?.Value ?? string.Empty;
        var ts       = DateTimeOffset.TryParse(rawDate, out var dt)
                     ? dt.ToUnixTimeMilliseconds() : 0L;
        var date     = ts > 0
                     ? DateTimeOffset.FromUnixTimeMilliseconds(ts)
                                     .ToString("MMM d, yyyy") : string.Empty;

        var durRaw   = el.Element(Itunes + "duration")?.Value
                    ?? el.Element("duration")?.Value ?? string.Empty;

        return new FeedItem
        {
            Title = title, AudioUrl = audioUrl, ArtUrl = itemArt,
            Description = desc, Duration = FormatDuration(durRaw),
            PublishDate = date, Timestamp = ts,
            IsAudio = isAudio, FeedName = feedName, FeedId = feedId
        };
    }

    private static string FormatDuration(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        if (Regex.IsMatch(raw, @"^\d{1,2}:\d{2}")) return raw;
        if (int.TryParse(raw, out var secs) && secs > 0)
        {
            var h = secs / 3600; var m = (secs % 3600) / 60; var s = secs % 60;
            return h > 0 ? $"{h}:{m:D2}:{s:D2}" : $"{m}:{s:D2}";
        }
        return raw;
    }
}
```

---

## 8. iTunes Search Service

```csharp
using System.Net.Http;
using System.Text.Json;
using QueueWave.Models;

namespace QueueWave.Services;

public record PodcastSearchResult(
    string CollectionName,
    string ArtistName,
    string FeedUrl,
    string ArtworkUrl100,
    int    TrackCount,
    string PrimaryGenreName
);

public class ItunesSearchService
{
    private static readonly HttpClient Http = new();

    public async Task<List<PodcastSearchResult>> SearchAsync(string query)
    {
        var url = $"https://itunes.apple.com/search?term={Uri.EscapeDataString(query)}" +
                  "&media=podcast&entity=podcast&limit=25";
        var json = await Http.GetStringAsync(url);
        using var doc = JsonDocument.Parse(json);
        var results = doc.RootElement.GetProperty("results");
        return results.EnumerateArray()
            .Where(r => r.TryGetProperty("feedUrl", out _))
            .Select(r => new PodcastSearchResult(
                r.TryGetProperty("collectionName",   out var cn)  ? cn.GetString()  ?? "" : "",
                r.TryGetProperty("artistName",       out var an)  ? an.GetString()  ?? "" : "",
                r.TryGetProperty("feedUrl",          out var fu)  ? fu.GetString()  ?? "" : "",
                r.TryGetProperty("artworkUrl100",    out var art) ? art.GetString() ?? "" : "",
                r.TryGetProperty("trackCount",       out var tc)  ? tc.GetInt32()        : 0,
                r.TryGetProperty("primaryGenreName", out var gn)  ? gn.GetString()  ?? "" : ""
            ))
            .ToList();
    }
}
```

---

## 9. Player Service (LibVLC)

```csharp
using LibVLCSharp.Shared;

namespace QueueWave.Services;

public class PlayerService : IDisposable
{
    private readonly LibVLC      _vlc;
    private readonly MediaPlayer _mp;

    public event Action<TimeSpan, TimeSpan>? ProgressChanged;
    public event Action?                      TrackEnded;
    public event Action<bool>?                PlayStateChanged;

    public bool    IsPlaying  => _mp.IsPlaying;
    public float   Volume
    {
        get => _mp.Volume / 100f;
        set => _mp.Volume = (int)(value * 100);
    }
    public float   Rate
    {
        get => _mp.Rate;
        set => _mp.Rate = value;
    }

    public PlayerService()
    {
        Core.Initialize();                          // required once
        _vlc = new LibVLC("--no-video");
        _mp  = new MediaPlayer(_vlc);

        _mp.TimeChanged   += (_, e) =>
        {
            var cur = TimeSpan.FromMilliseconds(e.Time);
            var tot = TimeSpan.FromMilliseconds(_mp.Length);
            ProgressChanged?.Invoke(cur, tot);
        };
        _mp.EndReached    += (_, _) => TrackEnded?.Invoke();
        _mp.Playing       += (_, _) => PlayStateChanged?.Invoke(true);
        _mp.Paused        += (_, _) => PlayStateChanged?.Invoke(false);
        _mp.Stopped       += (_, _) => PlayStateChanged?.Invoke(false);
    }

    public void Play(string url)
    {
        var media = new Media(_vlc, url, FromType.FromLocation);
        _mp.Play(media);
        media.Dispose();
    }

    public void TogglePlay()
    {
        if (_mp.IsPlaying) _mp.Pause();
        else _mp.Play();
    }

    public void Pause()  => _mp.Pause();
    public void Stop()   => _mp.Stop();

    public void Seek(double fraction)
    {
        if (_mp.IsSeekable)
            _mp.Position = (float)Math.Clamp(fraction, 0, 1);
    }

    public void SkipSeconds(int seconds)
    {
        var target = _mp.Time + seconds * 1000L;
        _mp.Time = Math.Clamp(target, 0, _mp.Length);
    }

    public void Dispose() { _mp.Dispose(); _vlc.Dispose(); }
}
```

---

## 10. Persistence Service

```csharp
using System.Text.Json;
using QueueWave.Models;

namespace QueueWave.Services;

public class PersistenceService
{
    // Stored in %APPDATA%/QueueWave on Windows,
    // ~/.config/QueueWave on Linux (XDG_CONFIG_HOME)
    private static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "QueueWave");

    private static readonly string AutoSavePath = Path.Combine(Dir, "state.json");

    private static readonly JsonSerializerOptions Opts = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public async Task AutoSaveAsync(AppState state)
    {
        Directory.CreateDirectory(Dir);
        await File.WriteAllTextAsync(AutoSavePath,
            JsonSerializer.Serialize(state, Opts));
    }

    public async Task<AppState?> AutoLoadAsync()
    {
        if (!File.Exists(AutoSavePath)) return null;
        var json = await File.ReadAllTextAsync(AutoSavePath);
        return JsonSerializer.Deserialize<AppState>(json, Opts);
    }

    public async Task ExportAsync(AppState state, string path)
        => await File.WriteAllTextAsync(path, JsonSerializer.Serialize(state, Opts));

    public async Task<AppState?> ImportAsync(string path)
    {
        var json = await File.ReadAllTextAsync(path);
        return JsonSerializer.Deserialize<AppState>(json, Opts);
    }
}
```

---

## 11. Player Window XAML (Winamp-style)

### `Views/PlayerWindow.axaml`

```xml
<Window xmlns="https://github.com/avaloniaui"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        xmlns:vm="clr-namespace:QueueWave.ViewModels"
        x:Class="QueueWave.Views.PlayerWindow"
        Title="QueueWave"
        Width="420" Height="130"
        MinWidth="320" MinHeight="110"
        CanResize="true"
        SystemDecorations="None"
        TransparencyLevelHint="AcrylicBlur"
        Background="Transparent">

  <!-- Custom dark background -->
  <Border Background="#0d0e10" BorderBrush="#222330" BorderThickness="1"
          CornerRadius="4">
    <Grid RowDefinitions="28,Auto,Auto,42">

      <!-- CUSTOM TITLEBAR — drag here -->
      <Border Grid.Row="0" Background="#101114"
              PointerPressed="TitleBar_PointerPressed"
              Cursor="SizeAll">
        <Grid ColumnDefinitions="*,Auto">
          <TextBlock Text="QUEUEWAVE" Foreground="#e8971e"
                     FontFamily="Consolas" FontSize="11"
                     FontWeight="Bold" LetterSpacing="4"
                     VerticalAlignment="Center" Margin="10,0"/>
          <StackPanel Grid.Column="1" Orientation="Horizontal"
                      Margin="0,0,4,0" Spacing="2">
            <Button Content="🞔" Classes="wm-btn" Click="LibraryToggle_Click"
                    ToolTip.Tip="Toggle library"/>
            <Button Content="—" Classes="wm-btn" Click="Minimize_Click"/>
            <Button Content="×" Classes="wm-btn wm-close" Click="Close_Click"/>
          </StackPanel>
        </Grid>
      </Border>

      <!-- NOW PLAYING INFO -->
      <Grid Grid.Row="1" ColumnDefinitions="52,*,Auto" Margin="8,6,8,4">
        <Border Width="44" Height="44" CornerRadius="3"
                Background="#1a1b20" ClipToBounds="True">
          <Image Source="{Binding NowPlayingArt}"
                 Stretch="UniformToFill"/>
        </Border>
        <StackPanel Grid.Column="1" Margin="8,0" VerticalAlignment="Center">
          <TextBlock Text="{Binding NowPlayingTitle}"
                     Foreground="#ededf5" FontSize="13" FontWeight="SemiBold"
                     TextTrimming="CharacterEllipsis"/>
          <TextBlock Text="{Binding NowPlayingFeed}"
                     Foreground="#7a4e08" FontFamily="Consolas"
                     FontSize="9" Margin="0,2,0,0"/>
        </StackPanel>
        <TextBlock Grid.Column="2" VerticalAlignment="Center"
                   Foreground="#484960" FontFamily="Consolas" FontSize="10"
                   Text="{Binding TimeDisplay}" Margin="4,0"/>
      </Grid>

      <!-- PROGRESS BAR -->
      <Slider Grid.Row="2" Margin="8,2,8,4"
              Minimum="0" Maximum="1" Value="{Binding Progress}"
              Height="6"
              Classes="progress-slider"/>

      <!-- CONTROLS -->
      <Grid Grid.Row="3" ColumnDefinitions="*,Auto,*" Margin="6,0">

        <!-- Volume + Speed left side -->
        <StackPanel Orientation="Horizontal" Spacing="4"
                    VerticalAlignment="Center">
          <TextBlock Text="🔈" Foreground="#484960" FontSize="11"
                     VerticalAlignment="Center"/>
          <Slider Width="64" Minimum="0" Maximum="1"
                  Value="{Binding Volume}" Classes="compact-slider"/>
          <ComboBox SelectedValue="{Binding Speed}"
                    FontFamily="Consolas" FontSize="9"
                    Width="60">
            <ComboBoxItem Content="0.75×" Tag="0.75"/>
            <ComboBoxItem Content="1×"    Tag="1"  />
            <ComboBoxItem Content="1.25×" Tag="1.25"/>
            <ComboBoxItem Content="1.5×"  Tag="1.5" />
            <ComboBoxItem Content="2×"    Tag="2"   />
          </ComboBox>
        </StackPanel>

        <!-- Playback controls center -->
        <StackPanel Grid.Column="1" Orientation="Horizontal"
                    Spacing="4" HorizontalAlignment="Center">
          <Button Command="{Binding PrevCommand}"       Classes="ctrl-btn" Content="⏮"/>
          <Button Command="{Binding SkipBackCommand}"   Classes="ctrl-btn"
                  FontFamily="Consolas" FontSize="10" Content="-15"/>
          <Button Command="{Binding PlayPauseCommand}"  Classes="ctrl-btn play-btn"
                  Content="{Binding PlayPauseIcon}"/>
          <Button Command="{Binding SkipForwardCommand}" Classes="ctrl-btn"
                  FontFamily="Consolas" FontSize="10" Content="+30"/>
          <Button Command="{Binding NextCommand}"       Classes="ctrl-btn" Content="⏭"/>
        </StackPanel>

        <!-- Sleep + Auto right side -->
        <StackPanel Grid.Column="2" Orientation="Horizontal"
                    HorizontalAlignment="Right" Spacing="4"
                    VerticalAlignment="Center">
          <Button Command="{Binding SleepCommand}" Classes="ctrl-btn"
                  Content="⬛" ToolTip.Tip="Blackout / sleep screen"/>
          <ToggleButton IsChecked="{Binding AutoAdvance}"
                        FontFamily="Consolas" FontSize="9"
                        Content="AUTO" Classes="auto-toggle"/>
        </StackPanel>
      </Grid>

    </Grid>
  </Border>
</Window>
```

---

## 12. Key styles (App.axaml)

```xml
<Application xmlns="https://github.com/avaloniaui"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             x:Class="QueueWave.App">
  <Application.Styles>
    <FluentTheme/>
    <Style Selector="Window">
      <Setter Property="Background" Value="Transparent"/>
    </Style>

    <!-- Window management buttons -->
    <Style Selector="Button.wm-btn">
      <Setter Property="Background"    Value="Transparent"/>
      <Setter Property="Foreground"    Value="#484960"/>
      <Setter Property="FontSize"      Value="12"/>
      <Setter Property="Width"         Value="22"/>
      <Setter Property="Height"        Value="22"/>
      <Setter Property="Padding"       Value="0"/>
      <Setter Property="BorderThickness" Value="0"/>
    </Style>
    <Style Selector="Button.wm-btn:pointerover">
      <Setter Property="Foreground" Value="#e8971e"/>
    </Style>
    <Style Selector="Button.wm-close:pointerover">
      <Setter Property="Foreground" Value="#e05555"/>
    </Style>

    <!-- Playback control buttons -->
    <Style Selector="Button.ctrl-btn">
      <Setter Property="Background"      Value="Transparent"/>
      <Setter Property="Foreground"      Value="#484960"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Padding"         Value="6,4"/>
      <Setter Property="FontSize"        Value="14"/>
    </Style>
    <Style Selector="Button.ctrl-btn:pointerover">
      <Setter Property="Foreground" Value="#ededf5"/>
    </Style>
    <Style Selector="Button.play-btn">
      <Setter Property="Width"           Value="40"/>
      <Setter Property="Height"          Value="40"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="BorderBrush"     Value="#e8971e"/>
      <Setter Property="Foreground"      Value="#e8971e"/>
      <Setter Property="CornerRadius"    Value="20"/>
    </Style>
    <Style Selector="Button.play-btn:pointerover">
      <Setter Property="Background" Value="#e8971e"/>
      <Setter Property="Foreground" Value="#000000"/>
    </Style>

    <!-- Progress slider -->
    <Style Selector="Slider.progress-slider /template/ Track">
      <Setter Property="Background" Value="#1a1b20"/>
    </Style>
    <Style Selector="Slider.progress-slider /template/ Track#PART_IncreaseButton">
      <Setter Property="Background" Value="#1a1b20"/>
    </Style>
    <Style Selector="Slider.progress-slider /template/ Track#PART_DecreaseButton">
      <Setter Property="Background" Value="#e8971e"/>
    </Style>

    <!-- Auto toggle -->
    <Style Selector="ToggleButton.auto-toggle">
      <Setter Property="Background"      Value="Transparent"/>
      <Setter Property="Foreground"      Value="#484960"/>
      <Setter Property="BorderBrush"     Value="#222330"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding"         Value="5,3"/>
    </Style>
    <Style Selector="ToggleButton.auto-toggle:checked">
      <Setter Property="Foreground"  Value="#e8971e"/>
      <Setter Property="BorderBrush" Value="#e8971e"/>
    </Style>
  </Application.Styles>
</Application>
```

---

## 13. Code-behind: window chrome + drag

### `Views/PlayerWindow.axaml.cs`

```csharp
using Avalonia.Controls;
using Avalonia.Input;
using QueueWave.ViewModels;

namespace QueueWave.Views;

public partial class PlayerWindow : Window
{
    private LibraryWindow? _library;

    public PlayerWindow()
    {
        InitializeComponent();
        // Keyboard shortcuts
        KeyDown += (_, e) =>
        {
            switch (e.Key)
            {
                case Key.Space:  ViewModel?.PlayPauseCommand.Execute(null); break;
                case Key.Right when e.KeyModifiers == KeyModifiers.None:
                    ViewModel?.SkipForwardCommand.Execute(null); break;
                case Key.Left  when e.KeyModifiers == KeyModifiers.None:
                    ViewModel?.SkipBackCommand.Execute(null); break;
                case Key.Right when e.KeyModifiers == KeyModifiers.Shift:
                    ViewModel?.NextCommand.Execute(null); break;
                case Key.Left  when e.KeyModifiers == KeyModifiers.Shift:
                    ViewModel?.PrevCommand.Execute(null); break;
                case Key.B:      ViewModel?.SleepCommand.Execute(null); break;
                case Key.Escape: CloseSleep(); break;
            }
        };
    }

    private MainViewModel? ViewModel => DataContext as MainViewModel;

    // Drag the borderless window
    private void TitleBar_PointerPressed(object? sender, PointerPressedEventArgs e)
        => BeginMoveDrag(e);

    private void Minimize_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
        => WindowState = WindowState.Minimized;

    private void Close_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
        => Close();

    private void LibraryToggle_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        if (_library is null || !_library.IsVisible)
        {
            _library ??= new LibraryWindow { DataContext = DataContext };
            // snap below player window
            _library.Position = new Avalonia.PixelPoint(
                Position.X, Position.Y + (int)Height + 2);
            _library.Show();
        }
        else
        {
            _library.Hide();
        }
    }

    // Blackout overlay window
    private BlackoutWindow? _blackout;
    private void CloseSleep() => _blackout?.Close();

    // Called from ViewModel via event/command
    public void ShowBlackout()
    {
        _blackout = new BlackoutWindow();
        _blackout.Closed += (_, _) => _blackout = null;
        _blackout.Show();
    }
}
```

---

## 14. Blackout Window

```xml
<!-- Views/BlackoutWindow.axaml -->
<Window xmlns="https://github.com/avaloniaui"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        x:Class="QueueWave.Views.BlackoutWindow"
        Title="" Background="Black"
        SystemDecorations="None"
        WindowState="FullScreen"
        Topmost="True">
  <Grid>
    <TextBlock Text="CLICK TO WAKE"
               Foreground="#111111"
               FontFamily="Consolas" FontSize="12"
               HorizontalAlignment="Center"
               VerticalAlignment="Bottom"
               Margin="0,0,0,32"/>
  </Grid>
</Window>
```

```csharp
// Views/BlackoutWindow.axaml.cs
public partial class BlackoutWindow : Window
{
    public BlackoutWindow()
    {
        InitializeComponent();
        PointerPressed += (_, _) => Close();
        KeyDown        += (_, _) => Close();
    }
}
```

---

## 15. Main ViewModel (abbreviated)

```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using QueueWave.Models;
using QueueWave.Services;

namespace QueueWave.ViewModels;

public partial class MainViewModel : ObservableObject
{
    readonly RssService          _rss    = new();
    readonly ItunesSearchService _search = new();
    readonly PersistenceService  _save   = new();
    public   PlayerService       Player  { get; } = new();

    public ObservableCollection<PodcastFeed> Feeds { get; } = [];
    public ObservableCollection<FeedItem>    Queue { get; } = [];

    [ObservableProperty] string   _nowPlayingTitle = "Nothing playing";
    [ObservableProperty] string   _nowPlayingFeed  = "—";
    [ObservableProperty] string?  _nowPlayingArt;
    [ObservableProperty] double   _progress;
    [ObservableProperty] string   _timeDisplay     = "0:00 / 0:00";
    [ObservableProperty] string   _playPauseIcon   = "▶";
    [ObservableProperty] double   _volume          = 1.0;
    [ObservableProperty] float    _speed           = 1.0f;
    [ObservableProperty] bool     _autoAdvance     = true;
    [ObservableProperty] int      _currentIndex    = -1;

    public MainViewModel()
    {
        Player.ProgressChanged  += OnProgress;
        Player.TrackEnded       += OnTrackEnded;
        Player.PlayStateChanged += on => PlayPauseIcon = on ? "⏸" : "▶";

        // Wire volume/speed changes back to player
        PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Volume)) Player.Volume = (float)Volume;
            if (e.PropertyName == nameof(Speed))  Player.Rate   = Speed;
            if (e.PropertyName == nameof(Progress) && _seekingFromUI) SeekFromSlider();
        };
    }

    // --- Playback ---
    [RelayCommand]
    void PlayPause()
    {
        if (CurrentIndex < 0 && Queue.Count > 0) { PlayAt(0); return; }
        Player.TogglePlay();
    }

    [RelayCommand] void Prev()
    {
        // restart if > 4s in, otherwise previous track
        Player.SkipSeconds(-9999); // hack: seek to 0
        if (CurrentIndex > 0) PlayAt(CurrentIndex - 1);
    }
    [RelayCommand] void Next()
    {
        if (CurrentIndex < Queue.Count - 1) PlayAt(CurrentIndex + 1);
    }
    [RelayCommand] void SkipBack()    => Player.SkipSeconds(-15);
    [RelayCommand] void SkipForward() => Player.SkipSeconds(30);
    [RelayCommand] void Sleep()       => SleepRequested?.Invoke();

    public event Action? SleepRequested;

    void PlayAt(int i)
    {
        if (i < 0 || i >= Queue.Count) return;
        CurrentIndex    = i;
        var item        = Queue[i];
        NowPlayingTitle = item.Title;
        NowPlayingFeed  = item.FeedName;
        NowPlayingArt   = item.ArtUrl.Length > 0 ? item.ArtUrl : null;
        Player.Play(item.AudioUrl);
        AutoSave();
    }

    void OnProgress(TimeSpan cur, TimeSpan tot)
    {
        TimeDisplay = $"{Fmt(cur)} / {Fmt(tot)}";
        if (tot.TotalSeconds > 0 && !_seekingFromUI)
            Progress = cur.TotalSeconds / tot.TotalSeconds;
    }

    void OnTrackEnded()
    {
        if (AutoAdvance && CurrentIndex < Queue.Count - 1)
            Avalonia.Threading.Dispatcher.UIThread.Post(() => PlayAt(CurrentIndex + 1));
    }

    bool _seekingFromUI;
    void SeekFromSlider() => Player.Seek(Progress);

    // --- Queue ---
    [RelayCommand] void AddToQueue(FeedItem item)
    {
        if (Queue.Any(q => q.AudioUrl == item.AudioUrl)) return;
        Queue.Add(item);
        AutoSave();
    }
    [RelayCommand] void RemoveFromQueue(FeedItem item)
    {
        var i = Queue.IndexOf(item);
        Queue.Remove(item);
        if (i <= CurrentIndex) CurrentIndex--;
        AutoSave();
    }
    [RelayCommand] void ClearQueue()
    {
        Player.Stop(); Queue.Clear(); CurrentIndex = -1;
        NowPlayingTitle = "Nothing playing"; NowPlayingFeed = "—";
    }

    // --- Feeds ---
    [RelayCommand] async Task AddFeedAsync(string url)
    {
        var feed = await _rss.LoadAsync(url);
        if (feed is not null) { Feeds.Add(feed); AutoSave(); }
    }

    // --- Persistence ---
    async void AutoSave() => await _save.AutoSaveAsync(new AppState
    {
        Feeds  = [.. Feeds],
        Queue  = [.. Queue],
        Volume = Volume,
        Speed  = Speed
    });

    public async Task LoadSavedStateAsync()
    {
        var s = await _save.AutoLoadAsync();
        if (s is null) return;
        foreach (var f in s.Feeds) Feeds.Add(f);
        foreach (var q in s.Queue) Queue.Add(q);
        Volume = s.Volume; Speed = s.Speed;
    }

    static string Fmt(TimeSpan t) =>
        t.Hours > 0 ? $"{t.Hours}:{t.Minutes:D2}:{t.Seconds:D2}"
                    : $"{t.Minutes}:{t.Seconds:D2}";
}
```

---

## 16. Entry point

### `App.axaml.cs`
```csharp
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using QueueWave.ViewModels;
using QueueWave.Views;

public partial class App : Application
{
    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var vm  = new MainViewModel();
            var win = new PlayerWindow { DataContext = vm };

            // Wire sleep event from ViewModel to window
            vm.SleepRequested += win.ShowBlackout;

            desktop.MainWindow = win;
            desktop.MainWindow.Loaded += async (_, _)
                => await vm.LoadSavedStateAsync();
        }
        base.OnFrameworkInitializationCompleted();
    }
}
```

---

## 17. Build & run

```bash
# Run in dev
dotnet run --project QueueWave.App

# Publish self-contained — single folder, no .NET install needed on target
# Windows
dotnet publish QueueWave.App -c Release -r win-x64 \
  --self-contained -o ./dist/windows

# Linux x64
dotnet publish QueueWave.App -c Release -r linux-x64 \
  --self-contained -o ./dist/linux

# Linux ARM (Raspberry Pi, etc.)
dotnet publish QueueWave.App -c Release -r linux-arm64 \
  --self-contained -o ./dist/linux-arm
```

---

## 18. Library panel (structure only)

The `LibraryWindow` follows the same pattern as `PlayerWindow` but taller (~500px), with three `TabItem` sections:

```
┌─────────────────────────────────────────┐
│ [STATIONS]  [EPISODES]  [QUEUE]         │
│─────────────────────────────────────────│
│ STATIONS TAB:                           │
│   [🔍 FIND PODCASTS] [+ URL]            │
│   search results / feed list here       │
│─────────────────────────────────────────│
│ EPISODES TAB:                           │
│   episode rows with art + desc          │
│─────────────────────────────────────────│
│ QUEUE TAB:                              │
│   ↕ SORT ▾   ⇌ SHUFFLE   CLEAR         │
│   draggable queue rows                  │
└─────────────────────────────────────────┘
```

All data binds to the same `MainViewModel` instance passed from `PlayerWindow`, so the player and library stay in sync automatically.

---

## 19. Troubleshooting

| Problem | Fix |
|---|---|
| `Core.Initialize()` throws on Linux | `libvlc` not installed — `sudo pacman -S vlc` or `sudo apt install libvlc-dev` |
| No audio on Linux | Check PipeWire/PulseAudio is running: `systemctl --user status pipewire` |
| Window won't drag | Make sure `BeginMoveDrag(e)` is called on `PointerPressed`, not `PointerMoved` |
| Avalonia templates not found | Run `dotnet new install Avalonia.Templates` first |
| Podcast feed returns 403 | Some feeds block non-browser user agents — add `User-Agent: Mozilla/5.0` to `HttpClient` headers |
| Art images don't load | Use Avalonia's `AsyncImageLoader` package for async/cached image loading from URLs |

---

## 20. Packages summary

```
Avalonia                    — UI framework
Avalonia.Desktop            — desktop host
Avalonia.Themes.Fluent      — base theme (you'll override most of it)
Avalonia.ReactiveUI         — MVVM bindings
LibVLCSharp                 — audio engine
LibVLCSharp.Avalonia        — Avalonia integration
VideoLAN.LibVLC.Windows     — bundles libvlc on Windows (Linux uses system)
CommunityToolkit.Mvvm       — ObservableObject, RelayCommand
```

---

*Built for .NET 10 · Avalonia 11 · LibVLCSharp 3 · Windows & Linux*
