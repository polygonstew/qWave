using System;
using System.Collections.Generic;
using QueueWave.Models;

namespace QueueWave.Models;

public class AppState
{
    public int                Version   { get; set; } = 1;
    public DateTime           SavedAt   { get; set; } = DateTime.UtcNow;
    public List<PodcastFeed>  Feeds     { get; set; } = [];
    public List<FeedItem>     Queue     { get; set; } = [];
    public string             SortMode  { get; set; } = "manual";
    public double             Volume    { get; set; } = 1.0;
    public float              Speed     { get; set; } = 1.0f;
}