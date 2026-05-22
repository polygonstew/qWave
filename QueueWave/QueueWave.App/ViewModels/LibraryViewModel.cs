using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using QueueWave.Models;
using QueueWave.Services;

namespace QueueWave.ViewModels;

public partial class LibraryViewModel : ObservableObject
{
    readonly RssService          _rss    = new();
    readonly ItunesSearchService _search = new();
    readonly PersistenceService  _save   = new();

    public ObservableCollection<PodcastFeed>    Feeds            { get; } = [];
    public ObservableCollection<FeedItem>       Episodes         { get; } = [];
    public ObservableCollection<FeedItem>       Queue            { get; } = [];
    public ObservableCollection<PodcastSearchResult> SearchResults { get; } = [];

    [ObservableProperty] PodcastFeed?          _selectedFeed;
    [ObservableProperty] FeedItem?             _selectedEpisode;
    [ObservableProperty] FeedItem?             _selectedQueueItem;
    [ObservableProperty] string                _searchQuery      = string.Empty;
    [ObservableProperty] bool                  _isSearching      = false;
    [ObservableProperty] string                _sortMode         = "manual";
    [ObservableProperty] int                   _currentPlayIndex = -1;

    public event Action<string>? FeedAdded;
    public event Action?         QueueUpdated;

    partial void OnSelectedFeedChanged(PodcastFeed? value)
    {
        if (value is null) return;
        Episodes.Clear();
        foreach (var ep in value.Items) Episodes.Add(ep);
        RefreshEpisodeStates();
    }

    // ─── FEEDS ────────────────────────────────────────────────────────
    [RelayCommand]
    async Task AddFeedFromUrlAsync(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        try
        {
            var feed = await _rss.LoadAsync(url);
            if (feed is not null)
            {
                Feeds.Add(feed);
                SelectedFeed = feed;
                await AutoSaveAsync();
                FeedAdded?.Invoke(feed.Name);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error loading feed: {ex.Message}");
        }
    }

    [RelayCommand]
    async Task RefreshFeedAsync(PodcastFeed? feed)
    {
        if (feed is null || feed.Url.StartsWith("__local__")) return;
        try
        {
            var fresh = await _rss.LoadAsync(feed.Url);
            if (fresh is not null)
            {
                // Prepend new items
                var existing = new HashSet<string>(feed.Items.Select(x => x.AudioUrl));
                var newItems = fresh.Items.Where(x => !existing.Contains(x.AudioUrl)).ToList();
                foreach (var item in newItems) feed.Items.Insert(0, item);
                feed.LastRefresh = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                await AutoSaveAsync();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Refresh error: {ex.Message}");
        }
    }

    [RelayCommand]
    void RemoveFeed(PodcastFeed? feed)
    {
        if (feed is null) return;
        Feeds.Remove(feed);
        // Remove from queue too
        var toRemove = Queue.Where(q => q.FeedId == feed.Id).ToList();
        foreach (var q in toRemove) Queue.Remove(q);
        if (SelectedFeed == feed) SelectedFeed = Feeds.FirstOrDefault();
    }

    // ─── EPISODES ──────────────────────────────────────────────────────
    [RelayCommand]
    void AddEpisodeToQueue(FeedItem? episode)
    {
        if (episode is null || Queue.Any(q => q.AudioUrl == episode.AudioUrl)) return;
        Queue.Add(episode);
        RefreshEpisodeStates();
        QueueUpdated?.Invoke();
    }

    [RelayCommand]
    void PlayEpisodeNow(FeedItem? episode)
    {
        if (episode is null) return;
        // Find or add to queue, then signal to main player
        var existing = Queue.FirstOrDefault(q => q.AudioUrl == episode.AudioUrl);
        if (existing is null)
        {
            Queue.Insert(0, episode);
            existing = Queue[0];
        }
        SelectedQueueItem = existing;
        QueueUpdated?.Invoke();
    }

    void RefreshEpisodeStates()
    {
        // Update episode buttons to show if already in queue
        foreach (var ep in Episodes)
        {
            // This would be handled by the view binding in a real app
            // just marking the logic here
        }
    }

    // ─── QUEUE ────────────────────────────────────────────────────────
    [RelayCommand]
    void RemoveFromQueue(FeedItem? item)
    {
        if (item is null) return;
        Queue.Remove(item);
        QueueUpdated?.Invoke();
    }

    [RelayCommand]
    void ClearQueue()
    {
        Queue.Clear();
        QueueUpdated?.Invoke();
    }

    [RelayCommand]
    void ShuffleQueue()
    {
        var list = Queue.ToList();
        // Fisher-Yates shuffle
        for (int i = list.Count - 1; i > 0; i--)
        {
            int j = Random.Shared.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
        Queue.Clear();
        foreach (var item in list) Queue.Add(item);
        QueueUpdated?.Invoke();
    }

    [RelayCommand]
    void MoveQueueItemUp(FeedItem? item)
    {
        if (item is null) return;
        int idx = Queue.IndexOf(item);
        if (idx > 0)
        {
            Queue.Move(idx, idx - 1);
            QueueUpdated?.Invoke();
        }
    }

    [RelayCommand]
    void MoveQueueItemDown(FeedItem? item)
    {
        if (item is null) return;
        int idx = Queue.IndexOf(item);
        if (idx >= 0 && idx < Queue.Count - 1)
        {
            Queue.Move(idx, idx + 1);
            QueueUpdated?.Invoke();
        }
    }

    [RelayCommand]
    void SortQueue(string mode)
    {
        SortMode = mode;
        var list = Queue.ToList();

        list = mode switch
        {
            "newest"   => list.OrderByDescending(x => x.Timestamp).ToList(),
            "oldest"   => list.OrderBy(x => x.Timestamp).ToList(),
            "az"       => list.OrderBy(x => x.Title).ToList(),
            "za"       => list.OrderByDescending(x => x.Title).ToList(),
            "station"  => list.OrderBy(x => x.FeedName).ToList(),
            "duration" => list.OrderBy(x => DurationSeconds(x.Duration)).ToList(),
            _          => list  // manual
        };

        Queue.Clear();
        foreach (var item in list) Queue.Add(item);
        QueueUpdated?.Invoke();
    }

    static int DurationSeconds(string dur)
    {
        if (string.IsNullOrEmpty(dur)) return 0;
        var parts = dur.Split(':');
        return parts.Length switch
        {
            3 => int.Parse(parts[0]) * 3600 + int.Parse(parts[1]) * 60 + int.Parse(parts[2]),
            2 => int.Parse(parts[0]) * 60 + int.Parse(parts[1]),
            _ => 0
        };
    }

    // ─── SEARCH ───────────────────────────────────────────────────────
    [RelayCommand]
    async Task SearchPodcastsAsync()
    {
        if (string.IsNullOrWhiteSpace(SearchQuery)) return;
        IsSearching = true;
        try
        {
            var results = await _search.SearchAsync(SearchQuery);
            SearchResults.Clear();
            foreach (var r in results) SearchResults.Add(r);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Search error: {ex.Message}");
        }
        finally { IsSearching = false; }
    }

    [RelayCommand]
    async Task AddSearchResultAsync(PodcastSearchResult? result)
    {
        if (result is null || string.IsNullOrEmpty(result.FeedUrl)) return;
        await AddFeedFromUrlAsync(result.FeedUrl);
    }

    // ─── PERSISTENCE ──────────────────────────────────────────────────
    async Task AutoSaveAsync()
    {
        var state = new AppState
        {
            Feeds = [..Feeds],
            Queue = [..Queue],
            SortMode = SortMode
        };
        await _save.AutoSaveAsync(state);
    }

    public async Task LoadSavedStateAsync()
    {
        var s = await _save.AutoLoadAsync();
        if (s is null) return;
        foreach (var f in s.Feeds) Feeds.Add(f);
        foreach (var q in s.Queue) Queue.Add(q);
        SortMode = s.SortMode;
        SelectedFeed = Feeds.FirstOrDefault();
    }
}