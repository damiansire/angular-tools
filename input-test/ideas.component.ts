import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ideas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>Ideas</h1>
    <p>Your ideas will be displayed here.</p>
  `,
  styles: [
    `
      .contenedor {
        padding: 20px;
        border: 1px solid #ccc;
        border-radius: 5px;
      }
      h1 {
        color: blue;
      }
    `,
  ],
})
export class IdeasComponent {}
