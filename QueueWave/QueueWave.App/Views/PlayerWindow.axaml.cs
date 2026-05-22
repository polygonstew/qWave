using System;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
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