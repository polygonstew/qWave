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
    [RelayCommand]
    async Task AddFeedAsync(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
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