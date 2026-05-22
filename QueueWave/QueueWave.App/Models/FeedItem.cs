using System;
   
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