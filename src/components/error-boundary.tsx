import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
	children: ReactNode;
};

type State = {
	error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Paperite renderer crash:", error, info.componentStack);
	}

	handleReload = () => {
		this.setState({ error: null });
		window.location.reload();
	};

	render() {
		if (!this.state.error) return this.props.children;

		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
				<h1 className="text-lg font-semibold">
					Something went wrong rendering this note
				</h1>
				<p className="max-w-md text-sm text-muted-foreground">
					Your notes are safe on disk — this is just a display problem. Try
					reloading. If it keeps happening, check the note file in your file
					manager for unusual content.
				</p>
				<Button type="button" onClick={this.handleReload}>
					Reload Paperite
				</Button>
			</div>
		);
	}
}
